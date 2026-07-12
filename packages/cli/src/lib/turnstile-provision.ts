import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { resolveProjectWorkerName } from './project-runtime.js';
import {
  resolveCaptchaHostnames,
  type CaptchaConfig,
  type EdgeBaseConfig,
} from '@edge-base/shared';

export interface TurnstileProvisionResult {
  siteKey: string;
  secretKey: string;
  widgetName?: string;
  hostnames: string[];
  managed: boolean;
  source: 'manual' | 'created' | 'existing';
  /** Present only while an existing widget has a staged old∪new hostname set. */
  managedFinalize?: {
    workerName: string;
    widgetName: string;
    widgetMode: string;
    desiredHostnames: string[];
    stagedHostnames: string[];
  };
  managedLegacyCleanup?: {
    baseWidgetName: string;
    workerName: string;
  };
}

const TURNSTILE_API_TIMEOUT_MS = 10_000;
const MAX_TURNSTILE_API_RESPONSE_BYTES = 256 * 1024;
const TURNSTILE_CONCURRENT_DEPLOY_GRACE_MS = 15 * 60 * 1000;
const TURNSTILE_LEGACY_ROLLBACK_WIDGETS = 2;

function sameHostnameSet(left: string[] | undefined, right: string[]): boolean {
  const normalize = (values: string[]) => Array.from(new Set(
    values.map((hostname) => hostname.trim().toLowerCase()),
  )).sort();
  const normalized = normalize(left ?? []);
  const expected = normalize(right);
  return normalized.length === expected.length
    && normalized.every((hostname, index) => hostname === expected[index]);
}

type TurnstileApiResult<T> = {
  ok: boolean;
  status: number;
  body: T;
};

interface ManagedTurnstileWidget {
  name: string;
  sitekey: string;
  secret?: string;
  domains?: string[];
  mode?: string;
  created_on?: string;
}

function isEdgeBaseManagedWidgetName(name: string, baseWidgetName: string): boolean {
  if (name === baseWidgetName || name.startsWith(`${baseWidgetName}-`)) return true;
  // Pre-lease 0.3.9 previews truncated long base names before appending a
  // hostname hash/random suffix. Retain this narrow pattern only for migration
  // and cleanup; new code never creates it.
  const escapedPrefix = baseWidgetName.slice(0, 224).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escapedPrefix}-[a-f0-9]{16}(?:-[a-f0-9]{12})?$`).test(name);
}

async function listManagedTurnstileWidgets(
  accountId: string,
  apiToken: string,
  baseWidgetName: string,
): Promise<ManagedTurnstileWidget[]> {
  const widgets = new Map<string, ManagedTurnstileWidget>();
  const perPage = 1000;
  for (let page = 1; page <= 100; page += 1) {
    const query = new URLSearchParams({
      filter: `name:${baseWidgetName.slice(0, 224)}`,
      order: 'created_on',
      direction: 'desc',
      page: String(page),
      per_page: String(perPage),
    });
    const response = await callTurnstileApi<{
      result?: ManagedTurnstileWidget[];
      success?: boolean;
      errors?: Array<{ message?: string }>;
      result_info?: {
        page?: number;
        per_page?: number;
        total_count?: number;
      };
    }>(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets?${query}`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    if (!response.ok || response.body.success !== true) {
      const detail = response.body.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join(', ') || `HTTP ${response.status}`;
      throw new Error(`Turnstile widget list failed: ${detail}`);
    }
    for (const widget of response.body.result ?? []) {
      if (
        widget
        && typeof widget.name === 'string'
        && typeof widget.sitekey === 'string'
        && isEdgeBaseManagedWidgetName(widget.name, baseWidgetName)
      ) {
        widgets.set(widget.sitekey, widget);
      }
    }

    const info = response.body.result_info;
    if (!info || !Number.isFinite(info.total_count)) break;
    const currentPage = Number.isFinite(info.page) ? Number(info.page) : page;
    const currentPerPage = Number.isFinite(info.per_page)
      ? Number(info.per_page)
      : perPage;
    if (currentPage * currentPerPage >= Number(info.total_count)) break;
    if (page === 100) {
      throw new Error('Turnstile widget list exceeded 100 paginated API responses.');
    }
  }
  return [...widgets.values()];
}

async function getManagedTurnstileWidgetDetails(
  accountId: string,
  apiToken: string,
  siteKey: string,
): Promise<ManagedTurnstileWidget> {
  const detailResponse = await callTurnstileApi<{
    success?: boolean;
    result?: ManagedTurnstileWidget;
    errors?: Array<{ message?: string }>;
  }>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets/${encodeURIComponent(siteKey)}`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  if (
    !detailResponse.ok
    || detailResponse.body.success !== true
    || !detailResponse.body.result
    || detailResponse.body.result.sitekey !== siteKey
  ) {
    const detail = detailResponse.body.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join(', ') || `HTTP ${detailResponse.status}`;
    throw new Error(`Turnstile widget details failed: ${detail}`);
  }
  return detailResponse.body.result;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (
    Number.isFinite(declaredLength)
    && declaredLength > MAX_TURNSTILE_API_RESPONSE_BYTES
  ) {
    throw new Error('Turnstile Management API response exceeded 256 KiB.');
  }
  if (!response.body) throw new Error('Turnstile Management API returned an empty response.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_TURNSTILE_API_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Turnstile Management API response exceeded 256 KiB.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error('Turnstile Management API returned malformed JSON.');
  }
}

async function callTurnstileApi<T>(
  url: string,
  init: RequestInit,
): Promise<TurnstileApiResult<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TURNSTILE_API_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await readBoundedJson(response) as T,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Turnstile Management API request timed out after 10000ms.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function recentWorkerVersionCaptchaSiteKeys(
  accountId: string,
  apiToken: string,
  workerName: string,
): Promise<Set<string>> {
  const encodedWorkerName = encodeURIComponent(workerName);
  const listResponse = await callTurnstileApi<{
    success?: boolean;
    result?: Array<{ id?: string }>;
    errors?: Array<{ message?: string }>;
  }>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodedWorkerName}/versions?deployable=true&per_page=10`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  if (!listResponse.ok || listResponse.body.success !== true) {
    const detail = listResponse.body.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join(', ') || `HTTP ${listResponse.status}`;
    throw new Error(`Worker version list failed during Turnstile cleanup: ${detail}`);
  }

  const versionIds = (listResponse.body.result ?? [])
    .map((version) => version.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .slice(0, 10);
  const details = await Promise.all(versionIds.map(async (versionId) => {
    const response = await callTurnstileApi<{
      success?: boolean;
      result?: {
        resources?: {
          bindings?: Array<{ name?: unknown; type?: unknown; text?: unknown }>;
        };
      };
      errors?: Array<{ message?: string }>;
    }>(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodedWorkerName}/versions/${encodeURIComponent(versionId)}`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    if (!response.ok || response.body.success !== true || !response.body.result) {
      const detail = response.body.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join(', ') || `HTTP ${response.status}`;
      throw new Error(`Worker version details failed during Turnstile cleanup: ${detail}`);
    }
    return response.body.result.resources?.bindings ?? [];
  }));

  const protectedSiteKeys = new Set<string>();
  for (const binding of details.flat()) {
    if (
      binding.name === 'CAPTCHA_SITE_KEY'
      && binding.type === 'plain_text'
      && typeof binding.text === 'string'
      && binding.text.trim()
    ) {
      protectedSiteKeys.add(binding.text.trim());
    }
  }
  return protectedSiteKeys;
}

interface WorkerDeployment {
  versions?: Array<{ version_id?: unknown; percentage?: unknown }>;
}

interface WorkerDeploymentSnapshot {
  state: 'absent' | 'no-deployment' | 'active';
  versions: Array<{ versionId: string; percentage: number }>;
}

interface LiveWorkerCaptchaVersion {
  versionId: string;
  percentage: number;
  siteKey: string | null;
  hostnames: string[] | null;
}

interface LiveWorkerCaptchaState {
  snapshot: WorkerDeploymentSnapshot;
  versions: LiveWorkerCaptchaVersion[];
}

function normalizeBoundCaptchaHostname(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('*')) return null;
  try {
    const parsed = new URL(`https://${trimmed}`);
    if (
      parsed.username
      || parsed.password
      || parsed.port
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) return null;
    return parsed.hostname
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
      .toLowerCase();
  } catch {
    return null;
  }
}

function parseBoundCaptchaHostnames(value: string, versionId: string): string[] {
  const hostnames = new Set<string>();
  for (const entry of value.split(',')) {
    const hostname = normalizeBoundCaptchaHostname(entry);
    if (!hostname) {
      throw new Error(
        `Live Worker version '${versionId}' has an invalid CAPTCHA_HOSTNAMES binding.`,
      );
    }
    hostnames.add(hostname);
  }
  const normalized = [...hostnames].sort();
  if (normalized.length === 0 || normalized.length > 10) {
    throw new Error(
      `Live Worker version '${versionId}' has an invalid CAPTCHA_HOSTNAMES binding.`,
    );
  }
  return normalized;
}

function sameWorkerDeploymentSnapshot(
  left: WorkerDeploymentSnapshot,
  right: WorkerDeploymentSnapshot,
): boolean {
  return left.state === right.state
    && left.versions.length === right.versions.length
    && left.versions.every((version, index) => {
      const expected = right.versions[index];
      return expected?.versionId === version.versionId
        && expected.percentage === version.percentage;
    });
}

async function readWorkerDeploymentSnapshot(
  accountId: string,
  apiToken: string,
  workerName: string,
): Promise<WorkerDeploymentSnapshot> {
  const encodedWorkerName = encodeURIComponent(workerName);
  const deploymentsResponse = await callTurnstileApi<{
    success?: boolean;
    result?: { deployments?: WorkerDeployment[] };
    errors?: Array<{ code?: number; message?: string }>;
  }>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodedWorkerName}/deployments`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  const deployments = deploymentsResponse.body.result?.deployments;
  if (!deploymentsResponse.ok || deploymentsResponse.body.success !== true || !deployments) {
    const workerAbsent = deploymentsResponse.status === 404
      && deploymentsResponse.body.errors?.some((error) =>
        error.code === 10090
        || error.code === 10092
        || /Worker.*(?:not found|does not exist)/i.test(error.message ?? ''),
      );
    if (workerAbsent) return { state: 'absent', versions: [] };
    const detail = deploymentsResponse.body.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join(', ') || `HTTP ${deploymentsResponse.status}`;
    throw new Error(`Live Worker deployment lookup failed during Turnstile staging: ${detail}`);
  }
  // A Worker script may exist before its first deployment. Under the remote
  // lease this is the same safe ownership state as a brand-new Worker.
  const deployment = deployments[0];
  if (!deployment) return { state: 'no-deployment', versions: [] };
  const activeVersions = (deployment.versions ?? [])
    .filter((version) => Number(version.percentage) > 0)
    .map((version) => ({
      versionId: version.version_id,
      percentage: Number(version.percentage),
    }))
    .filter((version): version is { versionId: string; percentage: number } =>
      typeof version.versionId === 'string'
      && version.versionId.length > 0
      && Number.isFinite(version.percentage),
    )
    .sort((left, right) => left.versionId.localeCompare(right.versionId));
  if (activeVersions.length === 0) {
    throw new Error('The live Worker deployment has no active version.');
  }

  return { state: 'active', versions: activeVersions };
}

async function readLiveWorkerCaptchaState(
  accountId: string,
  apiToken: string,
  workerName: string,
  snapshot?: WorkerDeploymentSnapshot,
): Promise<LiveWorkerCaptchaState> {
  const resolvedSnapshot = snapshot ?? await readWorkerDeploymentSnapshot(
    accountId,
    apiToken,
    workerName,
  );
  if (resolvedSnapshot.state !== 'active') {
    return { snapshot: resolvedSnapshot, versions: [] };
  }

  const encodedWorkerName = encodeURIComponent(workerName);
  const versions = await Promise.all(resolvedSnapshot.versions.map(async (activeVersion) => {
    const versionId = activeVersion.versionId;
    const response = await callTurnstileApi<{
      success?: boolean;
      result?: {
        resources?: {
          bindings?: Array<{ name?: unknown; type?: unknown; text?: unknown }>;
        };
      };
      errors?: Array<{ message?: string }>;
    }>(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodedWorkerName}/versions/${encodeURIComponent(versionId)}`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    if (!response.ok || response.body.success !== true || !response.body.result) {
      const detail = response.body.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join(', ') || `HTTP ${response.status}`;
      throw new Error(`Live Worker version details failed during Turnstile staging: ${detail}`);
    }
    const bindings = response.body.result.resources?.bindings ?? [];
    const siteKeys = new Set<string>();
    const hostnameBindings = new Set<string>();
    for (const binding of bindings) {
      if (binding.type !== 'plain_text' || typeof binding.text !== 'string') continue;
      if (binding.name === 'CAPTCHA_SITE_KEY' && binding.text.trim()) {
        siteKeys.add(binding.text.trim());
      }
      if (binding.name === 'CAPTCHA_HOSTNAMES' && binding.text.trim()) {
        hostnameBindings.add(binding.text.trim());
      }
    }
    if (siteKeys.size > 1 || hostnameBindings.size > 1) {
      throw new Error(
        `Live Worker version '${versionId}' has conflicting CAPTCHA runtime bindings.`,
      );
    }
    const hostnameBinding = [...hostnameBindings][0];
    return {
      ...activeVersion,
      siteKey: [...siteKeys][0] ?? null,
      hostnames: hostnameBinding
        ? parseBoundCaptchaHostnames(hostnameBinding, versionId)
        : null,
    };
  }));

  return { snapshot: resolvedSnapshot, versions };
}

function uniqueLiveCaptchaSiteKey(state: LiveWorkerCaptchaState): string | null {
  const siteKeys = new Set(
    state.versions
      .map((version) => version.siteKey)
      .filter((siteKey): siteKey is string => Boolean(siteKey)),
  );
  if (siteKeys.size > 1) {
    throw new Error(
      'The live Worker deployment serves multiple CAPTCHA site keys. '
      + 'Finish or roll back the gradual deployment before changing CAPTCHA hostnames.',
    );
  }
  return [...siteKeys][0] ?? null;
}

function liveHostnamesForSiteKey(
  state: LiveWorkerCaptchaState,
  siteKey: string,
): string[] | null {
  const matchingVersions = state.versions.filter((version) => version.siteKey === siteKey);
  if (matchingVersions.length === 0) return [];
  if (matchingVersions.some((version) => version.hostnames === null)) return null;
  return Array.from(new Set(
    matchingVersions.flatMap((version) => version.hostnames ?? []),
  )).sort();
}

async function updateManagedTurnstileHostnames(
  accountId: string,
  apiToken: string,
  widget: ManagedTurnstileWidget,
  hostnames: string[],
  phase: 'stage' | 'finalize',
): Promise<void> {
  const mode = widget.mode;
  if (!['managed', 'invisible', 'non-interactive'].includes(mode ?? '')) {
    throw new Error('Cloudflare returned an invalid Turnstile widget mode.');
  }
  const response = await callTurnstileApi<{
    success?: boolean;
    result?: ManagedTurnstileWidget;
    errors?: Array<{ message?: string }>;
  }>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets/${encodeURIComponent(widget.sitekey)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: widget.name, domains: hostnames, mode }),
    },
  );
  if (
    !response.ok
    || response.body.success !== true
    || !response.body.result
    || response.body.result.sitekey !== widget.sitekey
    || response.body.result.name !== widget.name
    || !sameHostnameSet(response.body.result.domains, hostnames)
  ) {
    const detail = response.body.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join(', ') || `HTTP ${response.status}`;
    throw new Error(`Turnstile hostname ${phase} failed: ${detail}`);
  }
}

function workerVersionIsSolelyLive(
  snapshot: WorkerDeploymentSnapshot,
  expectedVersionId: string,
): boolean {
  return snapshot.state === 'active'
    && snapshot.versions.length === 1
    && snapshot.versions[0]?.versionId === expectedVersionId
    && snapshot.versions[0]?.percentage === 100;
}

async function restoreLiveWorkerHostnames(
  accountId: string,
  apiToken: string,
  workerName: string,
  widgetSiteKey: string,
  snapshot: WorkerDeploymentSnapshot,
): Promise<'restored' | 'not-live'> {
  const liveState = await readLiveWorkerCaptchaState(
    accountId,
    apiToken,
    workerName,
    snapshot,
  );
  const requiredHostnames = liveHostnamesForSiteKey(liveState, widgetSiteKey);
  if (requiredHostnames?.length === 0) return 'not-live';
  if (!requiredHostnames) {
    throw new Error(
      'the replacement live Worker version does not expose CAPTCHA_HOSTNAMES for recovery',
    );
  }
  if (requiredHostnames.length > 10) {
    throw new Error(
      'the replacement live Worker versions require more than ten CAPTCHA hostnames',
    );
  }

  const currentWidget = await getManagedTurnstileWidgetDetails(
    accountId,
    apiToken,
    widgetSiteKey,
  );
  const validCurrentHostnames = (currentWidget.domains ?? [])
    .map((hostname) => normalizeBoundCaptchaHostname(hostname))
    .filter((hostname): hostname is string => Boolean(hostname));
  const preservingCurrent = Array.from(new Set([
    ...validCurrentHostnames,
    ...requiredHostnames,
  ].map((hostname) => hostname.trim().toLowerCase()))).sort();
  // Active Worker bindings are authoritative for production availability. If
  // preserving an unknown actor's staged extras would exceed the provider
  // limit, prefer the complete active set over our own now-aborted transition.
  const recoveryHostnames = preservingCurrent.length <= 10
    ? preservingCurrent
    : requiredHostnames;
  await updateManagedTurnstileHostnames(
    accountId,
    apiToken,
    currentWidget,
    recoveryHostnames,
    'stage',
  );
  const afterRestore = await readWorkerDeploymentSnapshot(accountId, apiToken, workerName);
  if (!sameWorkerDeploymentSnapshot(snapshot, afterRestore)) {
    throw new Error('the live Worker deployment changed again while restoring CAPTCHA hostnames');
  }
  return 'restored';
}

export async function finalizeTurnstileProvision(
  result: TurnstileProvisionResult | null,
  accountId: string,
  expectedWorkerVersionId: string | null,
  beforeManagedMutation?: () => Promise<void>,
): Promise<void> {
  const finalize = result?.managedFinalize;
  if (!result?.managed || !finalize) return;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required to finalize Turnstile hostnames.');
  if (!expectedWorkerVersionId) {
    throw new Error(
      'Wrangler did not report the deployed Worker version ID; the safe staged hostname union was left in place.',
    );
  }
  const beforeFinalize = await readWorkerDeploymentSnapshot(
    accountId,
    apiToken,
    finalize.workerName,
  );
  if (!workerVersionIsSolelyLive(beforeFinalize, expectedWorkerVersionId)) {
    throw new Error(
      'A different or gradual Worker deployment is live; the safe staged Turnstile hostname union was left in place.',
    );
  }
  const beforeFinalizeWidget = await getManagedTurnstileWidgetDetails(
    accountId,
    apiToken,
    result.siteKey,
  );
  if (
    beforeFinalizeWidget.name !== finalize.widgetName
    || beforeFinalizeWidget.mode !== finalize.widgetMode
    || !sameHostnameSet(beforeFinalizeWidget.domains, finalize.stagedHostnames)
  ) {
    throw new Error(
      'The managed Turnstile widget changed after this deploy staged it; '
      + 'the current hostname union was left untouched for the other deploy.',
    );
  }
  // The caller renews the owner-conditional D1 lease after both ownership
  // reads and immediately before the exact hostname PUT. A suspended process
  // must not resume with an expired lease and erase a newer owner's union.
  await beforeManagedMutation?.();
  await updateManagedTurnstileHostnames(
    accountId,
    apiToken,
    beforeFinalizeWidget,
    finalize.desiredHostnames,
    'finalize',
  );
  let afterFinalize: WorkerDeploymentSnapshot | null = null;
  let ownershipError: unknown;
  try {
    afterFinalize = await readWorkerDeploymentSnapshot(
      accountId,
      apiToken,
      finalize.workerName,
    );
  } catch (error) {
    ownershipError = error;
  }
  if (afterFinalize && workerVersionIsSolelyLive(afterFinalize, expectedWorkerVersionId)) return;

  // Close the PUT/check race against manual or pre-lease deploy tooling. The
  // replacement Worker's immutable CAPTCHA_HOSTNAMES binding is authoritative:
  // a widget GET here only sees our stale exact PUT and cannot reveal the
  // hostname that the replacement version now needs.
  try {
    if (!afterFinalize) throw ownershipError;
    await restoreLiveWorkerHostnames(
      accountId,
      apiToken,
      finalize.workerName,
      result.siteKey,
      afterFinalize,
    );
  } catch (restoreError) {
    throw new Error(
      'Worker deployment ownership changed after Turnstile finalization, and restoring '
      + `the staged hostname union also failed: ${(restoreError as Error).message}`,
    );
  }
  throw new Error(
    'Worker deployment ownership changed after Turnstile finalization; the active '
    + `Worker CAPTCHA hostname set was restored.${ownershipError ? ` ${(ownershipError as Error).message}` : ''}`,
  );
}

/**
 * Delete only legacy version-named widgets that cannot be used by current or
 * recent Worker versions. New deploys use one stable widget; this bounded
 * compatibility cleanup drains artifacts made by pre-lease CLI releases.
 */
export async function cleanupLegacyTurnstileWidgets(
  result: TurnstileProvisionResult | null,
  accountId: string,
  now = Date.now(),
): Promise<Array<{ name: string; siteKey: string }>> {
  const cleanup = result?.managedLegacyCleanup;
  if (!result?.managed || !cleanup) return [];
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    throw new Error('CLOUDFLARE_API_TOKEN is required to clean up legacy Turnstile widgets.');
  }

  const [widgets, protectedSiteKeys] = await Promise.all([
    listManagedTurnstileWidgets(accountId, apiToken, cleanup.baseWidgetName),
    recentWorkerVersionCaptchaSiteKeys(accountId, apiToken, cleanup.workerName),
  ]);
  protectedSiteKeys.add(result.siteKey);

  const ordered = [...widgets].sort((left, right) => {
    const leftTime = Date.parse(left.created_on ?? '');
    const rightTime = Date.parse(right.created_on ?? '');
    return (Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER)
      - (Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER);
  });
  const rollbackSiteKeys = new Set(
    ordered
      .filter((widget) => !protectedSiteKeys.has(widget.sitekey))
      .slice(0, TURNSTILE_LEGACY_ROLLBACK_WIDGETS)
      .map((widget) => widget.sitekey),
  );
  const graceBoundary = now - TURNSTILE_CONCURRENT_DEPLOY_GRACE_MS;
  const retired = ordered.filter((widget) => {
    if (protectedSiteKeys.has(widget.sitekey) || rollbackSiteKeys.has(widget.sitekey)) {
      return false;
    }
    const createdAt = Date.parse(widget.created_on ?? '');
    return Number.isFinite(createdAt) && createdAt < graceBoundary;
  });

  const deleted: Array<{ name: string; siteKey: string }> = [];
  for (const widget of retired) {
    const response = await callTurnstileApi<{
      success?: boolean;
      errors?: Array<{ message?: string }>;
    }>(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets/${encodeURIComponent(widget.sitekey)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiToken}` },
      },
    );
    if (!response.ok || response.body.success !== true) {
      const detail = response.body.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join(', ') || `HTTP ${response.status}`;
      throw new Error(`Legacy Turnstile widget cleanup failed for '${widget.name}': ${detail}`);
    }
    deleted.push({ name: widget.name, siteKey: widget.sitekey });
  }
  return deleted;
}

/**
 * Provision Cloudflare Turnstile widget via Management API.
 * If config.captcha === true: auto-create widget, store secret.
 * If config.captcha is CaptchaConfig: use provided keys.
 *
 * @returns { siteKey, secretKey } or null if captcha not configured.
 */
export async function provisionTurnstile(
  captchaConfig: boolean | CaptchaConfig | undefined,
  projectDir: string,
  configJson: Record<string, unknown>,
  knownAccountId?: string,
  beforeManagedMutation?: () => Promise<void>,
): Promise<TurnstileProvisionResult | null> {
  if (!captchaConfig) return null;

  const hostnames = resolveCaptchaHostnames(configJson as EdgeBaseConfig);
  if (hostnames.length === 0 || hostnames.length > 10) {
    throw new Error(
      'CAPTCHA deployment requires 1-10 exact hostnames. Set captcha.hostnames '
      + 'or configure baseUrl/CORS/auth redirect origins before deploying.',
    );
  }

  if (typeof captchaConfig === 'object') {
    const secretKey = captchaConfig.secretKey?.trim()
      || process.env.TURNSTILE_SECRET?.trim();
    if (!secretKey) {
      throw new Error(
        'Manual CAPTCHA requires TURNSTILE_SECRET in the deployment environment. '
        + 'Inline captcha.secretKey is supported only for local development.',
      );
    }
    console.log(chalk.green('✓'), 'Captcha: using manual siteKey and runtime secret');
    return {
      siteKey: captchaConfig.siteKey,
      secretKey,
      hostnames,
      managed: false,
      source: 'manual',
    };
  }

  console.log(chalk.blue('🛡️  Provisioning Cloudflare Turnstile...'));

  const cfAccountId =
    knownAccountId ??
    process.env.CLOUDFLARE_ACCOUNT_ID ??
    (() => {
      const wranglerPath = join(projectDir, 'wrangler.toml');
      if (existsSync(wranglerPath)) {
        const content = readFileSync(wranglerPath, 'utf-8');
        const match = content.match(
          /^\s*account_id\s*=\s*(?:"([^"]+)"|'([^']+)')/m,
        );
        return match?.[1] ?? match?.[2];
      }
      return undefined;
    })();

  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!cfAccountId || !apiToken) {
    console.log(
      chalk.yellow('⚠'),
      'Turnstile auto-provisioning requires CLOUDFLARE_API_TOKEN env var.',
    );
    console.log(chalk.dim(
      '  For manual mode set captcha.siteKey/hostnames and provide TURNSTILE_SECRET in .env.release.',
    ));
    throw new Error('Turnstile auto-provisioning credentials are missing.');
  }

  const projectName = resolveProjectWorkerName(projectDir, {
    fallbackToProjectSlug: true,
  });
  const widgetName = `${projectName.slice(0, 246)}-captcha`;

  try {
    // This read happens after the caller has acquired the remote deploy lease.
    // Never branch on a pre-lease existence hint: another cooperative deploy
    // may have completed while this process was waiting for the lease.
    const initialLiveState = await readLiveWorkerCaptchaState(
      cfAccountId,
      apiToken,
      projectName,
    );
    const initialSnapshot = initialLiveState.snapshot;
    const widgets = await listManagedTurnstileWidgets(
      cfAccountId,
      apiToken,
      widgetName,
    );
    const liveSiteKey = uniqueLiveCaptchaSiteKey(initialLiveState);
    if (liveSiteKey) {
      let detailedWidget = await getManagedTurnstileWidgetDetails(
        cfAccountId,
        apiToken,
        liveSiteKey,
      );
      if (!isEdgeBaseManagedWidgetName(detailedWidget.name, widgetName)) {
        throw new Error(
          'The live Worker CAPTCHA site key is not an EdgeBase-managed Turnstile widget. '
          + 'Use manual CAPTCHA configuration or restore the managed widget before deploying.',
        );
      }
      if (!detailedWidget.secret?.trim() || !Array.isArray(detailedWidget.domains)) {
        throw new Error('Cloudflare did not return complete live Turnstile widget details.');
      }
      if (
        detailedWidget.domains.length === 0
        || detailedWidget.domains.length > 10
        || detailedWidget.domains.some((hostname) =>
          typeof hostname !== 'string' || !normalizeBoundCaptchaHostname(hostname),
        )
      ) {
        throw new Error('Cloudflare returned invalid live Turnstile widget hostnames.');
      }
      const boundLiveHostnames = liveHostnamesForSiteKey(initialLiveState, liveSiteKey) ?? [];
      let stagedHostnames = Array.from(new Set([
        ...detailedWidget.domains,
        ...boundLiveHostnames,
        ...hostnames,
      ].map((hostname) => hostname.trim().toLowerCase()))).sort();
      if (stagedHostnames.length > 10) {
        throw new Error(
          'Turnstile hostname transition would exceed the provider limit of 10. '
          + 'Deploy an intermediate hostname set that keeps old∪new at ten or fewer, then retry.',
        );
      }
      if (
        !sameHostnameSet(detailedWidget.domains, stagedHostnames)
        || detailedWidget.name !== widgetName
      ) {
        await beforeManagedMutation?.();

        // Renewing the cooperative lease is not enough to defend against
        // manual/pre-lease tooling. Recheck immutable live version ownership
        // and the widget immediately before the destructive exact PUT.
        const beforeStage = await readWorkerDeploymentSnapshot(
          cfAccountId,
          apiToken,
          projectName,
        );
        if (!sameWorkerDeploymentSnapshot(initialSnapshot, beforeStage)) {
          throw new Error(
            'The live Worker deployment changed before Turnstile staging; no widget mutation was made. Retry the deploy.',
          );
        }
        const latestWidget = await getManagedTurnstileWidgetDetails(
          cfAccountId,
          apiToken,
          liveSiteKey,
        );
        if (!isEdgeBaseManagedWidgetName(latestWidget.name, widgetName)) {
          throw new Error(
            'The managed Turnstile widget changed ownership before staging; no widget mutation was made.',
          );
        }
        if (!latestWidget.secret?.trim() || !Array.isArray(latestWidget.domains)) {
          throw new Error('Cloudflare did not return complete live Turnstile widget details.');
        }
        stagedHostnames = Array.from(new Set([
          ...latestWidget.domains,
          ...boundLiveHostnames,
          ...hostnames,
        ].map((hostname) => hostname.trim().toLowerCase()))).sort();
        if (stagedHostnames.length > 10) {
          throw new Error(
            'Turnstile hostname transition would exceed the provider limit of 10. '
            + 'Deploy an intermediate hostname set that keeps old∪new at ten or fewer, then retry.',
          );
        }
        if (
          !sameHostnameSet(latestWidget.domains, stagedHostnames)
          || latestWidget.name !== widgetName
        ) {
          await updateManagedTurnstileHostnames(
            cfAccountId,
            apiToken,
            { ...latestWidget, name: widgetName },
            stagedHostnames,
            'stage',
          );
          const afterStage = await readWorkerDeploymentSnapshot(
            cfAccountId,
            apiToken,
            projectName,
          );
          if (!sameWorkerDeploymentSnapshot(beforeStage, afterStage)) {
            try {
              const recovered = await restoreLiveWorkerHostnames(
                cfAccountId,
                apiToken,
                projectName,
                liveSiteKey,
                afterStage,
              );
              throw new Error(
                'The live Worker deployment changed during Turnstile staging; '
                + (recovered === 'restored'
                  ? 'the replacement live hostname set was restored and this deploy was aborted.'
                  : 'the staged widget is no longer live and this deploy was aborted.'),
              );
            } catch (recoveryError) {
              if ((recoveryError as Error).message.includes('this deploy was aborted')) {
                throw recoveryError;
              }
              throw new Error(
                'The live Worker deployment changed during Turnstile staging, and restoring '
                + `its CAPTCHA hostname set failed: ${(recoveryError as Error).message}`,
              );
            }
          }
          console.log(chalk.dim(
            `  Turnstile widget '${widgetName}': staged ${stagedHostnames.length} transition hostname(s)`,
          ));
        }
        detailedWidget = latestWidget;
      } else {
        console.log(chalk.dim(
          `  Turnstile widget '${detailedWidget.name}': live tuple reused → ${liveSiteKey.slice(0, 8)}…`,
        ));
      }
      return {
        siteKey: liveSiteKey,
        secretKey: detailedWidget.secret!,
        widgetName,
        hostnames,
        managed: true,
        source: 'existing',
        ...(!sameHostnameSet(stagedHostnames, hostnames) ? {
          managedFinalize: {
            workerName: projectName,
            widgetName,
            widgetMode: detailedWidget.mode ?? 'managed',
            desiredHostnames: hostnames,
            stagedHostnames,
          },
        } : {}),
        managedLegacyCleanup: {
          baseWidgetName: widgetName,
          workerName: projectName,
        },
      };
    }

    // First-live path (new Worker or script with no deployment): converge on
    // one stable base widget. Legacy version-named widgets are not selected or
    // created here; post-deploy compatibility cleanup drains them safely.
    const baseWidgets = widgets.filter((widget) => widget.name === widgetName);
    if (baseWidgets.length > 1) {
      throw new Error(
        `Multiple Turnstile widgets are named '${widgetName}'. `
        + 'Remove the unused duplicates in Cloudflare before the first live deploy.',
      );
    }
    const existingBaseWidget = baseWidgets[0];
    if (existingBaseWidget) {
      let detailedWidget = await getManagedTurnstileWidgetDetails(
        cfAccountId,
        apiToken,
        existingBaseWidget.sitekey,
      );
      if (!detailedWidget.secret?.trim()) {
        throw new Error('Cloudflare did not return the existing Turnstile widget secret.');
      }
      if (
        !Array.isArray(detailedWidget.domains)
        || detailedWidget.domains.length === 0
        || detailedWidget.domains.length > 10
        || detailedWidget.domains.some((hostname) =>
          typeof hostname !== 'string' || !normalizeBoundCaptchaHostname(hostname),
        )
      ) {
        throw new Error('Cloudflare returned invalid existing Turnstile widget hostnames.');
      }
      let stagedHostnames = Array.from(new Set([
        ...(detailedWidget.domains ?? []),
        ...hostnames,
      ].map((hostname) => hostname.trim().toLowerCase()))).sort();
      if (stagedHostnames.length > 10) {
        throw new Error(
          'Turnstile hostname transition would exceed the provider limit of 10. '
          + 'Deploy an intermediate hostname set that keeps old∪new at ten or fewer, then retry.',
        );
      }
      if (!sameHostnameSet(detailedWidget.domains, stagedHostnames)) {
        await beforeManagedMutation?.();
        const beforeStage = await readWorkerDeploymentSnapshot(
          cfAccountId,
          apiToken,
          projectName,
        );
        if (!sameWorkerDeploymentSnapshot(initialSnapshot, beforeStage)) {
          throw new Error(
            'The live Worker deployment changed before first-live Turnstile staging; no widget mutation was made. Retry the deploy.',
          );
        }
        const latestWidget = await getManagedTurnstileWidgetDetails(
          cfAccountId,
          apiToken,
          existingBaseWidget.sitekey,
        );
        if (!latestWidget.secret?.trim()) {
          throw new Error('Cloudflare did not return the existing Turnstile widget secret.');
        }
        if (
          !Array.isArray(latestWidget.domains)
          || latestWidget.domains.length === 0
          || latestWidget.domains.length > 10
          || latestWidget.domains.some((hostname) =>
            typeof hostname !== 'string' || !normalizeBoundCaptchaHostname(hostname),
          )
        ) {
          throw new Error('Cloudflare returned invalid existing Turnstile widget hostnames.');
        }
        // No live Worker does not mean every existing domain is ours to
        // delete. Another (possibly non-cooperating) deploy may already have
        // staged its future hostname on this stable widget. Preserve the
        // latest current∪desired set and reduce it only after our version owns
        // 100% of traffic.
        stagedHostnames = Array.from(new Set([
          ...(latestWidget.domains ?? []),
          ...hostnames,
        ].map((hostname) => hostname.trim().toLowerCase()))).sort();
        if (stagedHostnames.length > 10) {
          throw new Error(
            'Turnstile hostname transition would exceed the provider limit of 10. '
            + 'Deploy an intermediate hostname set that keeps old∪new at ten or fewer, then retry.',
          );
        }
        if (!sameHostnameSet(latestWidget.domains, stagedHostnames)) {
          await updateManagedTurnstileHostnames(
            cfAccountId,
            apiToken,
            latestWidget,
            stagedHostnames,
            'stage',
          );
          const afterStage = await readWorkerDeploymentSnapshot(
            cfAccountId,
            apiToken,
            projectName,
          );
          if (!sameWorkerDeploymentSnapshot(beforeStage, afterStage)) {
            try {
              await restoreLiveWorkerHostnames(
                cfAccountId,
                apiToken,
                projectName,
                existingBaseWidget.sitekey,
                afterStage,
              );
            } catch (recoveryError) {
              throw new Error(
                'The live Worker deployment changed during first-live Turnstile staging, and '
                + `restoring its CAPTCHA hostname set failed: ${(recoveryError as Error).message}`,
              );
            }
            throw new Error(
              'The live Worker deployment changed during first-live Turnstile staging; '
              + 'the replacement live hostname set was restored and this deploy was aborted.',
            );
          }
        }
        detailedWidget = latestWidget;
      }
      console.log(
        chalk.dim(
          `  Turnstile widget '${widgetName}': stable tuple reused → ${existingBaseWidget.sitekey.slice(0, 8)}…`,
        ),
      );
      return {
        siteKey: existingBaseWidget.sitekey,
        secretKey: detailedWidget.secret!,
        widgetName,
        hostnames,
        managed: true,
        source: 'existing',
        ...(!sameHostnameSet(stagedHostnames, hostnames) ? {
          managedFinalize: {
            workerName: projectName,
            widgetName,
            widgetMode: detailedWidget.mode ?? 'managed',
            desiredHostnames: hostnames,
            stagedHostnames,
          },
        } : {}),
        managedLegacyCleanup: {
          baseWidgetName: widgetName,
          workerName: projectName,
        },
      };
    }
    const createWidgetName = widgetName;

    await beforeManagedMutation?.();
    const beforeCreate = await readWorkerDeploymentSnapshot(
      cfAccountId,
      apiToken,
      projectName,
    );
    if (!sameWorkerDeploymentSnapshot(initialSnapshot, beforeCreate)) {
      throw new Error(
        'The live Worker deployment changed before Turnstile creation; no widget was created. Retry the deploy.',
      );
    }
    const widgetsBeforeCreate = await listManagedTurnstileWidgets(
      cfAccountId,
      apiToken,
      widgetName,
    );
    if (widgetsBeforeCreate.some((widget) => widget.name === widgetName)) {
      throw new Error(
        `Turnstile widget '${widgetName}' appeared concurrently; no duplicate was created. Retry the deploy.`,
      );
    }
    // The paginated duplicate scan is bounded but can be long on a very large
    // account. Revalidate lease ownership once more immediately before POST.
    await beforeManagedMutation?.();

    const createResp = await callTurnstileApi<{
      success?: boolean;
      result?: { sitekey: string; secret: string; domains?: string[] };
      errors?: Array<{ message: string }>;
    }>(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/challenges/widgets`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: createWidgetName, domains: hostnames, mode: 'managed' }),
      },
    );
    const createResult = createResp.body;
    if (
      createResp.ok
      && createResult?.success
      && createResult.result
      && createResult.result.sitekey?.trim()
      && createResult.result.secret?.trim()
      && sameHostnameSet(createResult.result.domains, hostnames)
    ) {
      const { sitekey, secret } = createResult.result;
      const afterCreate = await readWorkerDeploymentSnapshot(
        cfAccountId,
        apiToken,
        projectName,
      );
      if (!sameWorkerDeploymentSnapshot(beforeCreate, afterCreate)) {
        try {
          await restoreLiveWorkerHostnames(
            cfAccountId,
            apiToken,
            projectName,
            sitekey,
            afterCreate,
          );
        } catch (recoveryError) {
          throw new Error(
            'The live Worker deployment changed during Turnstile creation, and checking '
            + `the replacement CAPTCHA state failed: ${(recoveryError as Error).message}`,
          );
        }
        throw new Error(
          'The live Worker deployment changed during Turnstile creation; this deploy was aborted.',
        );
      }
      const widgetsAfterCreate = await listManagedTurnstileWidgets(
        cfAccountId,
        apiToken,
        widgetName,
      );
      const concurrentDuplicate = widgetsAfterCreate.find((widget) =>
        widget.name === widgetName && widget.sitekey !== sitekey,
      );
      if (concurrentDuplicate) {
        const deleteResponse = await callTurnstileApi<{
          success?: boolean;
          errors?: Array<{ message?: string }>;
        }>(
          `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/challenges/widgets/${encodeURIComponent(sitekey)}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${apiToken}` },
          },
        );
        if (!deleteResponse.ok || deleteResponse.body.success !== true) {
          const detail = deleteResponse.body.errors
            ?.map((error) => error.message)
            .filter(Boolean)
            .join(', ') || `HTTP ${deleteResponse.status}`;
          throw new Error(
            `A concurrent stable Turnstile widget was detected, but removing this deploy's duplicate failed: ${detail}`,
          );
        }
        throw new Error(
          `A concurrent stable Turnstile widget '${concurrentDuplicate.sitekey}' appeared; `
          + 'this deploy removed its own duplicate and aborted. Retry the deploy.',
        );
      }
      console.log(
        chalk.green('✓'),
        `Turnstile widget '${createWidgetName}': created → ${sitekey.slice(0, 8)}…`,
      );

      return {
        siteKey: sitekey,
        secretKey: secret,
        widgetName: createWidgetName,
        hostnames,
        managed: true,
        source: 'created',
        managedLegacyCleanup: {
          baseWidgetName: widgetName,
          workerName: projectName,
        },
      };
    }

    const errors = createResp.ok && createResult?.success && createResult.result
      ? 'Cloudflare returned a widget whose site key, secret, or hostname set was invalid.'
      : createResult?.errors?.map((e: { message: string }) => e.message).join(', ')
        ?? 'unknown error';
    console.log(chalk.yellow('⚠'), `Turnstile widget creation failed: ${errors}`);
    diagnoseTurnstileError(errors);
    throw new Error(`Turnstile widget creation failed: ${errors}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow('⚠'), `Turnstile provisioning failed: ${msg}`);
    diagnoseTurnstileError(msg);
    throw err;
  }
}

function diagnoseTurnstileError(errorMessage: string): void {
  const msg = errorMessage.toLowerCase();
  if (msg.includes('hostname transition')) {
    console.log(chalk.dim('    Keep the current hostnames, deploy an intermediate set of at most ten, then remove the retired entries.'));
  } else if (msg.includes('not enabled') || msg.includes('not found') || msg.includes('code: 10042')) {
    console.log(chalk.dim('    Turnstile may not be enabled on your Cloudflare account.'));
    console.log(chalk.dim('    To enable: Cloudflare Dashboard → Turnstile → Get Started'));
    console.log(chalk.dim('    Or remove "captcha" from edgebase.config.ts if not needed.'));
  } else if (msg.includes('authentication') || msg.includes('unauthorized') || msg.includes('forbidden')) {
    console.log(chalk.dim('    Your API token may lack Turnstile permissions.'));
    console.log(chalk.dim('    Ensure CLOUDFLARE_API_TOKEN has Account → Turnstile → Edit permissions.'));
  } else if (msg.includes('quota') || msg.includes('limit')) {
    console.log(chalk.dim('    You may have reached the Turnstile widget limit on your plan.'));
    console.log(chalk.dim('    Check: Cloudflare Dashboard → Turnstile'));
  }
}

/**
 * Inject the public site key and exact hostname allowlist into wrangler.toml.
 */
export function injectCaptchaSiteKey(
  wranglerPath: string,
  siteKey: string,
  hostnames: string[],
): void {
  if (!existsSync(wranglerPath)) {
    throw new Error(`Cannot inject CAPTCHA runtime config: ${wranglerPath} does not exist.`);
  }
  if (!siteKey.trim() || hostnames.length === 0 || hostnames.length > 10) {
    throw new Error('Cannot inject an empty CAPTCHA site key or hostname allowlist.');
  }

  const originalContent = readFileSync(wranglerPath, 'utf-8');
  const newline = originalContent.includes('\r\n') ? '\r\n' : '\n';
  const lines = originalContent.split(/\r?\n/);
  const firstTable = lines.findIndex((line) => /^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$/.test(line));
  const topLevelEnd = firstTable < 0 ? lines.length : firstTable;
  if (lines.slice(0, topLevelEnd).some((line) => /^\s*vars(?:\s*=\s*\{|\s*\.)/.test(line))) {
    throw new Error(
      'Cannot inject CAPTCHA vars into a top-level inline/dotted `vars` declaration. '
      + 'Convert it to a standard `[vars]` table and retry.',
    );
  }
  const values = {
    CAPTCHA_SITE_KEY: siteKey,
    CAPTCHA_HOSTNAMES: hostnames.join(','),
  };
  let varsStart = lines.findIndex((line) => /^\s*\[vars\]\s*(?:#.*)?$/.test(line));
  if (varsStart < 0) {
    if (lines.length > 0 && lines.at(-1) !== '') lines.push('');
    varsStart = lines.length;
    lines.push('[vars]');
  }

  let varsEnd = lines.findIndex((line, index) =>
    index > varsStart && /^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$/.test(line),
  );
  if (varsEnd < 0) varsEnd = lines.length;

  for (const [name, value] of Object.entries(values)) {
    const assignment = `${name} = ${JSON.stringify(value)}`;
    const pattern = new RegExp(`^\\s*${name}\\s*=`);
    const relativeIndex = lines
      .slice(varsStart + 1, varsEnd)
      .findIndex((line) => pattern.test(line));
    if (relativeIndex >= 0) {
      lines[varsStart + 1 + relativeIndex] = assignment;
    } else {
      lines.splice(varsStart + 1, 0, assignment);
      varsEnd += 1;
    }
  }
  writeFileSync(wranglerPath, lines.join(newline), 'utf-8');
  console.log(chalk.green('✓'), 'Captcha siteKey and exact hostnames injected into wrangler.toml');
}
