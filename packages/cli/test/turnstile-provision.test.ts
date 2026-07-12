import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanupLegacyTurnstileWidgets,
  finalizeTurnstileProvision,
  injectCaptchaSiteKey,
  provisionTurnstile,
} from '../src/lib/turnstile-provision.js';

let projectDir: string;
let originalApiToken: string | undefined;
let originalAccountId: string | undefined;
let originalTurnstileSecret: string | undefined;

const absentWorkerResponse = () => new Response(JSON.stringify({
  success: false,
  errors: [{ code: 10090, message: 'Worker not found' }],
}), { status: 404 });

const noDeploymentResponse = () => new Response(JSON.stringify({
  success: true,
  result: { deployments: [] },
}));

const deploymentResponse = (
  versions: Array<{ version_id: string; percentage: number }>,
) => new Response(JSON.stringify({
  success: true,
  result: { deployments: [{ versions }] },
}));

const captchaBindingsResponse = (siteKey: string, hostnames: string[]) => new Response(JSON.stringify({
  success: true,
  result: {
    resources: { bindings: [
      { name: 'CAPTCHA_SITE_KEY', type: 'plain_text', text: siteKey },
      { name: 'CAPTCHA_HOSTNAMES', type: 'plain_text', text: hostnames.join(',') },
    ] },
  },
}));

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'edgebase-turnstile-'));
  writeFileSync(join(projectDir, 'wrangler.toml'), 'name = "synthetic-app"\n[vars]\nEXISTING = "yes"\n');
  originalApiToken = process.env.CLOUDFLARE_API_TOKEN;
  originalAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  originalTurnstileSecret = process.env.TURNSTILE_SECRET;
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  if (originalApiToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
  else process.env.CLOUDFLARE_API_TOKEN = originalApiToken;
  if (originalAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
  else process.env.CLOUDFLARE_ACCOUNT_ID = originalAccountId;
  if (originalTurnstileSecret === undefined) delete process.env.TURNSTILE_SECRET;
  else process.env.TURNSTILE_SECRET = originalTurnstileSecret;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Turnstile deployment contract', () => {
  it('requires exact hostnames even with manual keys', async () => {
    await expect(provisionTurnstile(
      { siteKey: 'site', secretKey: 'secret' },
      projectDir,
      { release: true, captcha: { siteKey: 'site', secretKey: 'secret' } },
    )).rejects.toThrow(/1-10 exact hostnames/i);
  });

  it('returns manual keys with hostnames derived from public origins', async () => {
    process.env.TURNSTILE_SECRET = 'secret';
    const result = await provisionTurnstile(
      { siteKey: 'site' },
      projectDir,
      {
        baseUrl: 'https://api.example.test',
        cors: { origin: ['https://app.example.test'] },
        captcha: { siteKey: 'site' },
      },
    );

    expect(result).toMatchObject({
      siteKey: 'site',
      secretKey: 'secret',
      hostnames: ['api.example.test', 'app.example.test'],
      managed: false,
    });
  });

  it('creates a managed widget with exact domains instead of an Any Hostname wildcard', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(absentWorkerResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] })))
      .mockResolvedValueOnce(absentWorkerResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          sitekey: 'managed-site',
          secret: 'managed-secret',
          domains: ['api.example.test'],
        },
      })))
      .mockResolvedValueOnce(absentWorkerResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provisionTurnstile(true, projectDir, {
      baseUrl: 'https://api.example.test',
      captcha: true,
    });

    expect(result?.hostnames).toEqual(['api.example.test']);
    const createRequest = fetchMock.mock.calls[4]![1] as RequestInit;
    expect(JSON.parse(String(createRequest.body))).toEqual({
      name: 'synthetic-app-captcha',
      domains: ['api.example.test'],
      mode: 'managed',
    });
  });

  it('removes its own widget and aborts if a same-name widget is created concurrently', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    const own = {
      name: 'synthetic-app-captcha',
      sitekey: 'site-own',
      secret: 'secret-own',
      domains: ['api.example.test'],
      mode: 'managed',
    };
    const other = { ...own, sitekey: 'site-other', secret: undefined };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(absentWorkerResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] })))
      .mockResolvedValueOnce(absentWorkerResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: own })))
      .mockResolvedValueOnce(absentWorkerResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [other, own],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: {} })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(provisionTurnstile(true, projectDir, {
      baseUrl: 'https://api.example.test',
      captcha: true,
    })).rejects.toThrow(/concurrent stable Turnstile widget.*removed its own duplicate/i);
    expect(String(fetchMock.mock.calls[7]![0])).toContain('/widgets/site-own');
    expect((fetchMock.mock.calls[7]![1] as RequestInit).method).toBe('DELETE');
  });

  it('treats an existing Worker script with no deployment as a safe first-live path', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(noDeploymentResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] })))
      .mockResolvedValueOnce(noDeploymentResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          sitekey: 'stable-site',
          secret: 'stable-secret',
          domains: ['api.example.test'],
        },
      })))
      .mockResolvedValueOnce(noDeploymentResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const beforeManagedMutation = vi.fn().mockResolvedValue(undefined);

    const result = await provisionTurnstile(true, projectDir, {
      baseUrl: 'https://api.example.test',
      captcha: true,
    }, undefined, beforeManagedMutation);

    expect(result).toMatchObject({
      siteKey: 'stable-site',
      secretKey: 'stable-secret',
      widgetName: 'synthetic-app-captcha',
    });
    expect(beforeManagedMutation).toHaveBeenCalledTimes(2);
    const createBody = JSON.parse(String((fetchMock.mock.calls[4]![1] as RequestInit).body));
    expect(createBody.name).toBe('synthetic-app-captcha');
  });

  it('uses the canonical literal Worker name and follows paginated widget listings', async () => {
    writeFileSync(
      join(projectDir, 'wrangler.toml'),
      "   name = 'literal-app'\n[vars]\nEXISTING = 'yes'\n",
    );
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    const target = {
      name: 'literal-app-captcha',
      sitekey: 'managed-site',
      domains: ['api.example.test'],
      mode: 'managed',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(absentWorkerResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [],
        result_info: { page: 1, per_page: 1000, total_count: 1001 },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [target],
        result_info: { page: 2, per_page: 1000, total_count: 1001 },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...target, secret: 'managed-secret' },
      })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provisionTurnstile(true, projectDir, {
      baseUrl: 'https://api.example.test',
      captcha: true,
    });

    expect(result).toMatchObject({
      source: 'existing',
      widgetName: 'literal-app-captcha',
      siteKey: 'managed-site',
    });
    expect(String(fetchMock.mock.calls[1]![0])).toContain('filter=name%3Aliteral-app-captcha');
    expect(String(fetchMock.mock.calls[1]![0])).toContain('page=1');
    expect(String(fetchMock.mock.calls[2]![0])).toContain('page=2');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('preserves a concurrently pre-staged stable domain before a first live deployment', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    const existing = {
      name: 'synthetic-app-captcha',
      sitekey: 'managed-site',
      secret: 'managed-secret',
      domains: ['old.example.test'],
      mode: 'managed',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(absentWorkerResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [existing] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: existing,
      })))
      .mockResolvedValueOnce(absentWorkerResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...existing, domains: ['future.example.test', 'old.example.test'] },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          ...existing,
          domains: ['api.example.test', 'future.example.test', 'old.example.test'],
        },
      })))
      .mockResolvedValueOnce(absentWorkerResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await provisionTurnstile(true, projectDir, {
      baseUrl: 'https://api.example.test',
      captcha: true,
    });

    expect(result).toMatchObject({
      source: 'existing',
      siteKey: 'managed-site',
      secretKey: 'managed-secret',
      widgetName: 'synthetic-app-captcha',
      hostnames: ['api.example.test'],
      managedFinalize: {
        desiredHostnames: ['api.example.test'],
        stagedHostnames: ['api.example.test', 'future.example.test', 'old.example.test'],
      },
    });
    expect((fetchMock.mock.calls[5]![1] as RequestInit).method).toBe('PUT');
    expect(JSON.parse(String((fetchMock.mock.calls[5]![1] as RequestInit).body))).toEqual({
      name: 'synthetic-app-captcha',
      domains: ['api.example.test', 'future.example.test', 'old.example.test'],
      mode: 'managed',
    });
    expect(fetchMock.mock.calls.some((call) =>
      (call[1] as RequestInit | undefined)?.method === 'POST',
    )).toBe(false);
  });

  it('bounds a hung Turnstile Management API request', async () => {
    vi.useFakeTimers();
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })));

    const pending = provisionTurnstile(true, projectDir, {
      baseUrl: 'https://api.example.test',
      captcha: true,
    });
    const assertion = expect(pending).rejects.toThrow(/timed out after 10000ms/i);
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
  });

  it('rejects an oversized Turnstile Management API response', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', {
      headers: { 'Content-Length': String(256 * 1024 + 1) },
    })));

    await expect(provisionTurnstile(true, projectDir, {
      baseUrl: 'https://api.example.test',
      captcha: true,
    })).rejects.toThrow(/exceeded 256 KiB/i);
  });

  it('reuses the stable exact tuple on a first-live deploy', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    const listItem = {
      name: 'synthetic-app-captcha',
      sitekey: 'managed-site',
      domains: ['api.example.test'],
      mode: 'managed',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(absentWorkerResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [listItem] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...listItem, secret: 'managed-secret' },
      })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provisionTurnstile(true, projectDir, {
      baseUrl: 'https://api.example.test',
      captcha: true,
    });

    expect(result).toMatchObject({
      source: 'existing',
      siteKey: 'managed-site',
      secretKey: 'managed-secret',
      hostnames: ['api.example.test'],
    });
    expect((fetchMock.mock.calls[2]![1] as RequestInit | undefined)?.method).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stages old∪new on the live widget and finalizes exact only for its own live Worker version', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    const live = {
      name: 'synthetic-app-captcha-live',
      sitekey: 'site-live',
      domains: ['old.example.test'],
      mode: 'managed',
      created_on: '2026-07-11T10:00:00.000Z',
    };
    const oldVersion = '11111111-1111-4111-8111-111111111111';
    const newVersion = '22222222-2222-4222-8222-222222222222';
    const fetchMock = vi.fn()
      // Lease-held authoritative state, immutable bindings, then widget list/detail.
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: oldVersion, percentage: 100,
      }]))
      .mockResolvedValueOnce(captchaBindingsResponse('site-live', ['old.example.test']))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [live],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...live, secret: 'same-secret' },
      })))
      // Recheck ownership and latest widget immediately before the exact PUT.
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: oldVersion, percentage: 100,
      }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...live, secret: 'same-secret' },
      })))
      // Stage old∪new before Worker publish.
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          ...live,
          name: 'synthetic-app-captcha',
          domains: ['new.example.test', 'old.example.test'],
        },
      })))
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: oldVersion, percentage: 100,
      }]))
      // Finalizer ownership check and exact-hostname update.
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: newVersion, percentage: 100,
      }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          ...live,
          name: 'synthetic-app-captcha',
          domains: ['new.example.test', 'old.example.test'],
        },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...live, name: 'synthetic-app-captcha', domains: ['new.example.test'] },
      })))
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: newVersion, percentage: 100,
      }]));
    vi.stubGlobal('fetch', fetchMock);
    const beforeManagedMutation = vi.fn().mockResolvedValue(undefined);

    const result = await provisionTurnstile(true, projectDir, {
      baseUrl: 'https://new.example.test',
      captcha: true,
    }, undefined, beforeManagedMutation);

    expect(result).toMatchObject({
      siteKey: 'site-live',
      secretKey: 'same-secret',
      hostnames: ['new.example.test'],
      managedFinalize: {
        workerName: 'synthetic-app',
        desiredHostnames: ['new.example.test'],
        stagedHostnames: ['new.example.test', 'old.example.test'],
      },
    });
    const stageBody = JSON.parse(String((fetchMock.mock.calls[6]![1] as RequestInit).body));
    expect(stageBody).toMatchObject({
      name: 'synthetic-app-captcha',
      domains: ['new.example.test', 'old.example.test'],
      mode: 'managed',
    });
    expect(beforeManagedMutation).toHaveBeenCalledOnce();

    await finalizeTurnstileProvision(
      result,
      '0123456789abcdef0123456789abcdef',
      newVersion,
    );
    const finalizeBody = JSON.parse(String((fetchMock.mock.calls[10]![1] as RequestInit).body));
    expect(finalizeBody.domains).toEqual(['new.example.test']);
    expect(fetchMock).toHaveBeenCalledTimes(12);
  });

  it('aborts before staging when the live Worker changes after the lease renewal', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    const oldVersion = '11111111-1111-4111-8111-111111111111';
    const replacementVersion = '22222222-2222-4222-8222-222222222222';
    const live = {
      name: 'synthetic-app-captcha',
      sitekey: 'site-live',
      secret: 'same-secret',
      domains: ['old.example.test'],
      mode: 'managed',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: oldVersion, percentage: 100,
      }]))
      .mockResolvedValueOnce(captchaBindingsResponse('site-live', ['old.example.test']))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [live] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: live })))
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: replacementVersion, percentage: 100,
      }]));
    vi.stubGlobal('fetch', fetchMock);
    const renewLease = vi.fn().mockResolvedValue(undefined);

    await expect(provisionTurnstile(true, projectDir, {
      baseUrl: 'https://new.example.test',
      captcha: true,
    }, undefined, renewLease)).rejects.toThrow(/changed before Turnstile staging.*no widget mutation/i);
    expect(renewLease).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some((call) =>
      (call[1] as RequestInit | undefined)?.method === 'PUT',
    )).toBe(false);
  });

  it('restores replacement live hostnames when ownership changes during staging', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    const oldVersion = '11111111-1111-4111-8111-111111111111';
    const replacementVersion = '22222222-2222-4222-8222-222222222222';
    const live = {
      name: 'synthetic-app-captcha',
      sitekey: 'site-live',
      secret: 'same-secret',
      domains: ['old.example.test'],
      mode: 'managed',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: oldVersion, percentage: 100,
      }]))
      .mockResolvedValueOnce(captchaBindingsResponse('site-live', ['old.example.test']))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [live] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: live })))
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: oldVersion, percentage: 100,
      }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: live })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...live, domains: ['new.example.test', 'old.example.test'] },
      })))
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: replacementVersion, percentage: 100,
      }]))
      .mockResolvedValueOnce(captchaBindingsResponse(
        'site-live',
        ['replacement.example.test'],
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...live, domains: ['new.example.test', 'old.example.test'] },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          ...live,
          domains: ['new.example.test', 'old.example.test', 'replacement.example.test'],
        },
      })))
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: replacementVersion, percentage: 100,
      }]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(provisionTurnstile(true, projectDir, {
      baseUrl: 'https://new.example.test',
      captcha: true,
    })).rejects.toThrow(/changed during Turnstile staging.*replacement live hostname set was restored/i);
    const restoreBody = JSON.parse(String((fetchMock.mock.calls[10]![1] as RequestInit).body));
    expect(restoreBody.domains).toContain('replacement.example.test');
  });

  it('migrates a truncated long-name legacy widget without creating a generation', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    const workerName = 'w'.repeat(246);
    writeFileSync(join(projectDir, 'wrangler.toml'), `name = "${workerName}"\n[vars]\n`);
    const stableName = `${workerName}-captcha`;
    const legacyName = `${stableName.slice(0, 224)}-${'a'.repeat(16)}-${'b'.repeat(12)}`;
    const version = '11111111-1111-4111-8111-111111111111';
    const legacy = {
      name: legacyName,
      sitekey: 'site-live',
      secret: 'same-secret',
      domains: ['api.example.test'],
      mode: 'managed',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(deploymentResponse([{ version_id: version, percentage: 100 }]))
      .mockResolvedValueOnce(captchaBindingsResponse('site-live', ['api.example.test']))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [legacy] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: legacy })))
      .mockResolvedValueOnce(deploymentResponse([{ version_id: version, percentage: 100 }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: legacy })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...legacy, name: stableName },
      })))
      .mockResolvedValueOnce(deploymentResponse([{ version_id: version, percentage: 100 }]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provisionTurnstile(true, projectDir, {
      baseUrl: 'https://api.example.test',
      captcha: true,
    });

    expect(result).toMatchObject({ siteKey: 'site-live', widgetName: stableName });
    const updateBody = JSON.parse(String((fetchMock.mock.calls[6]![1] as RequestInit).body));
    expect(updateBody.name).toBe(stableName);
    expect(fetchMock.mock.calls.some((call) =>
      (call[1] as RequestInit | undefined)?.method === 'POST',
    )).toBe(false);
  });

  it('rejects an old∪new hostname transition above ten before mutating the widget', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    const live = {
      name: 'synthetic-app-captcha-live',
      sitekey: 'site-live',
      domains: Array.from({ length: 10 }, (_, index) => `old-${index}.example.test`),
      mode: 'managed',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: 'version-old', percentage: 100,
      }]))
      .mockResolvedValueOnce(captchaBindingsResponse(
        'site-live',
        Array.from({ length: 10 }, (_, index) => `old-${index}.example.test`),
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [live] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...live, secret: 'same-secret' },
      })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(provisionTurnstile(true, projectDir, {
      baseUrl: 'https://new.example.test',
      captcha: true,
    })).rejects.toThrow(/old∪new.*limit of 10|transition.*exceed/i);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.some((call) =>
      (call[1] as RequestInit | undefined)?.method === 'PUT',
    )).toBe(false);
  });

  it('leaves the staged union when a different Worker version is live at finalize time', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      result: { deployments: [{ versions: [{
        version_id: '33333333-3333-4333-8333-333333333333',
        percentage: 100,
      }] }] },
    })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(finalizeTurnstileProvision({
      siteKey: 'site-live',
      secretKey: 'same-secret',
      widgetName: 'synthetic-app-captcha-live',
      hostnames: ['new.example.test'],
      managed: true,
      source: 'existing',
      managedFinalize: {
        workerName: 'synthetic-app',
        widgetName: 'synthetic-app-captcha-live',
        widgetMode: 'managed',
        desiredHostnames: ['new.example.test'],
        stagedHostnames: ['new.example.test', 'old.example.test'],
      },
    }, '0123456789abcdef0123456789abcdef', 'expected-version'))
      .rejects.toThrow(/different or gradual Worker deployment.*staged.*left in place/i);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not exact-finalize when the owner-conditional lease renewal is lost', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    const expectedVersion = '11111111-2222-4333-8444-555555555555';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: expectedVersion,
        percentage: 100,
      }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          name: 'synthetic-app-captcha',
          sitekey: 'site-live',
          mode: 'managed',
          domains: ['new.example.test', 'old.example.test'],
        },
      })));
    vi.stubGlobal('fetch', fetchMock);
    const renewLease = vi.fn().mockRejectedValue(new Error('deploy lease ownership was lost'));

    await expect(finalizeTurnstileProvision({
      siteKey: 'site-live',
      secretKey: 'same-secret',
      widgetName: 'synthetic-app-captcha',
      hostnames: ['new.example.test'],
      managed: true,
      source: 'existing',
      managedFinalize: {
        workerName: 'synthetic-app',
        widgetName: 'synthetic-app-captcha',
        widgetMode: 'managed',
        desiredHostnames: ['new.example.test'],
        stagedHostnames: ['new.example.test', 'old.example.test'],
      },
    }, '0123456789abcdef0123456789abcdef', expectedVersion, renewLease))
      .rejects.toThrow(/lease ownership was lost/i);
    expect(renewLease).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not exact-finalize over an unknown hostname staged by another deploy', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    const expectedVersion = '11111111-2222-4333-8444-555555555555';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: expectedVersion,
        percentage: 100,
      }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          name: 'synthetic-app-captcha',
          sitekey: 'site-live',
          mode: 'managed',
          domains: ['new.example.test', 'old.example.test', 'other.example.test'],
        },
      })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(finalizeTurnstileProvision({
      siteKey: 'site-live',
      secretKey: 'same-secret',
      widgetName: 'synthetic-app-captcha',
      hostnames: ['new.example.test'],
      managed: true,
      source: 'existing',
      managedFinalize: {
        workerName: 'synthetic-app',
        widgetName: 'synthetic-app-captcha',
        widgetMode: 'managed',
        desiredHostnames: ['new.example.test'],
        stagedHostnames: ['new.example.test', 'old.example.test'],
      },
    }, '0123456789abcdef0123456789abcdef', expectedVersion))
      .rejects.toThrow(/widget changed after this deploy staged it.*left untouched/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some((call) =>
      (call[1] as RequestInit | undefined)?.method === 'PUT',
    )).toBe(false);
  });

  it('restores the replacement live binding if ownership changes after exact finalization', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    const expectedVersion = '11111111-2222-4333-8444-555555555555';
    const widget = {
      name: 'synthetic-app-captcha',
      sitekey: 'site-live',
      mode: 'managed',
    };
    const replacementVersion = '99999999-8888-4777-8666-555555555555';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: expectedVersion, percentage: 100,
      }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...widget, domains: ['new.example.test', 'old.example.test'] },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...widget, domains: ['new.example.test'] },
      })))
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: replacementVersion, percentage: 100,
      }]))
      // The replacement actor staged `replacement`, but our exact PUT above
      // already erased it. Recovery must derive it from the live binding.
      .mockResolvedValueOnce(captchaBindingsResponse(
        'site-live',
        ['replacement.example.test'],
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...widget, domains: ['new.example.test'] },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          ...widget,
          domains: ['new.example.test', 'replacement.example.test'],
        },
      })))
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: replacementVersion, percentage: 100,
      }]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(finalizeTurnstileProvision({
      siteKey: 'site-live',
      secretKey: 'same-secret',
      widgetName: widget.name,
      hostnames: ['new.example.test'],
      managed: true,
      source: 'existing',
      managedFinalize: {
        workerName: 'synthetic-app',
        widgetName: widget.name,
        widgetMode: 'managed',
        desiredHostnames: ['new.example.test'],
        stagedHostnames: ['new.example.test', 'old.example.test'],
      },
    }, '0123456789abcdef0123456789abcdef', expectedVersion))
      .rejects.toThrow(/ownership changed.*active Worker CAPTCHA hostname set was restored/i);
    const exactBody = JSON.parse(String((fetchMock.mock.calls[2]![1] as RequestInit).body));
    const restoreBody = JSON.parse(String((fetchMock.mock.calls[6]![1] as RequestInit).body));
    expect(exactBody.domains).toEqual(['new.example.test']);
    expect(restoreBody.domains).toEqual([
      'new.example.test',
      'replacement.example.test',
    ]);
  });

  it('restores its live site-key slice during a replacement gradual deployment', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    const expectedVersion = '11111111-2222-4333-8444-555555555555';
    const gradualA = '33333333-3333-4333-8333-333333333333';
    const gradualB = '44444444-4444-4444-8444-444444444444';
    const widget = {
      name: 'synthetic-app-captcha',
      sitekey: 'site-live',
      mode: 'managed',
    };
    const gradualDeployment = [
      { version_id: gradualA, percentage: 50 },
      { version_id: gradualB, percentage: 50 },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(deploymentResponse([{
        version_id: expectedVersion, percentage: 100,
      }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...widget, domains: ['new.example.test', 'old.example.test'] },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...widget, domains: ['new.example.test'] },
      })))
      .mockResolvedValueOnce(deploymentResponse(gradualDeployment))
      .mockResolvedValueOnce(captchaBindingsResponse('site-live', ['old.example.test']))
      .mockResolvedValueOnce(captchaBindingsResponse('site-other', ['other.example.test']))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...widget, domains: ['new.example.test'] },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { ...widget, domains: ['new.example.test', 'old.example.test'] },
      })))
      .mockResolvedValueOnce(deploymentResponse(gradualDeployment));
    vi.stubGlobal('fetch', fetchMock);

    await expect(finalizeTurnstileProvision({
      siteKey: 'site-live',
      secretKey: 'same-secret',
      widgetName: widget.name,
      hostnames: ['new.example.test'],
      managed: true,
      source: 'existing',
      managedFinalize: {
        workerName: 'synthetic-app',
        widgetName: widget.name,
        widgetMode: 'managed',
        desiredHostnames: ['new.example.test'],
        stagedHostnames: ['new.example.test', 'old.example.test'],
      },
    }, '0123456789abcdef0123456789abcdef', expectedVersion))
      .rejects.toThrow(/ownership changed.*active Worker CAPTCHA hostname set was restored/i);
    const restoreBody = JSON.parse(String((fetchMock.mock.calls[7]![1] as RequestInit).body));
    expect(restoreBody.domains).toEqual(['new.example.test', 'old.example.test']);
  });

  it('refuses to mutate while a gradual deployment serves different CAPTCHA site keys', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    const widgets = ['site-a', 'site-b'].map((sitekey) => ({
      name: `synthetic-app-captcha-${sitekey}`,
      sitekey,
      domains: ['old.example.test'],
      mode: 'managed',
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(deploymentResponse([
        { version_id: 'version-a', percentage: 50 },
        { version_id: 'version-b', percentage: 50 },
      ]))
      .mockResolvedValueOnce(captchaBindingsResponse('site-a', ['old.example.test']))
      .mockResolvedValueOnce(captchaBindingsResponse('site-b', ['new.example.test']))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: widgets })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(provisionTurnstile(true, projectDir, {
      baseUrl: 'https://new.example.test',
      captcha: true,
    })).rejects.toThrow(/multiple CAPTCHA site keys.*gradual deployment/i);
    expect(fetchMock.mock.calls.some((call) =>
      (call[1] as RequestInit | undefined)?.method === 'PUT',
    )).toBe(false);
  });

  it('cleans only old unreferenced legacy widgets after a successful Worker deploy', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    const now = Date.parse('2026-07-11T12:00:00.000Z');
    const widget = (sitekey: string, ageMs: number) => ({
      name: `synthetic-app-captcha-${sitekey}`,
      sitekey,
      domains: ['api.example.test'],
      created_on: new Date(now - ageMs).toISOString(),
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [
          widget('site-new', 60_000),
          widget('site-concurrent', 5 * 60_000),
          widget('site-rollback', 24 * 60 * 60_000),
          widget('site-protected-old', 2 * 24 * 60 * 60_000),
          widget('site-retired', 3 * 24 * 60 * 60_000),
        ],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [{ id: 'version-current' }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          resources: {
            bindings: [{
              name: 'CAPTCHA_SITE_KEY',
              type: 'plain_text',
              text: 'site-protected-old',
            }],
          },
        },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: {} })));
    vi.stubGlobal('fetch', fetchMock);

    const deleted = await cleanupLegacyTurnstileWidgets({
      siteKey: 'site-new',
      secretKey: 'synthetic-secret',
      widgetName: 'synthetic-app-captcha-site-new',
      hostnames: ['api.example.test'],
      managed: true,
      source: 'created',
      managedLegacyCleanup: {
        baseWidgetName: 'synthetic-app-captcha',
        workerName: 'synthetic-app',
      },
    }, '0123456789abcdef0123456789abcdef', now);

    expect(deleted).toEqual([{
      name: 'synthetic-app-captcha-site-retired',
      siteKey: 'site-retired',
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[3]![0])).toContain('/widgets/site-retired');
    expect((fetchMock.mock.calls[3]![1] as RequestInit).method).toBe('DELETE');
  });

  it('fails safe without deleting when recent Worker version authority is unavailable', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-api-token';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: false,
        errors: [{ message: 'synthetic outage' }],
      }), { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(cleanupLegacyTurnstileWidgets({
      siteKey: 'site-new',
      secretKey: 'synthetic-secret',
      hostnames: ['api.example.test'],
      managed: true,
      source: 'created',
      managedLegacyCleanup: {
        baseWidgetName: 'synthetic-app-captcha',
        workerName: 'synthetic-app',
      },
    }, '0123456789abcdef0123456789abcdef'))
      .rejects.toThrow(/Worker version list failed.*synthetic outage/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails instead of continuing when managed provisioning credentials are absent', async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;

    await expect(provisionTurnstile(true, projectDir, {
      baseUrl: 'https://api.example.test',
      captcha: true,
    })).rejects.toThrow(/credentials are missing/i);
  });

  it('injects and replaces both the site key and hostname allowlist', () => {
    const wranglerPath = join(projectDir, 'wrangler.toml');

    injectCaptchaSiteKey(wranglerPath, 'site-one', ['api.example.test']);
    injectCaptchaSiteKey(wranglerPath, 'site-two', ['api.example.test', 'app.example.test']);

    const content = readFileSync(wranglerPath, 'utf8');
    expect(content.match(/^CAPTCHA_SITE_KEY\s*=/gm)).toHaveLength(1);
    expect(content.match(/^CAPTCHA_HOSTNAMES\s*=/gm)).toHaveLength(1);
    expect(content).toContain('CAPTCHA_SITE_KEY = "site-two"');
    expect(content).toContain('CAPTCHA_HOSTNAMES = "api.example.test,app.example.test"');
  });

  it('upserts only root vars when an environment table contains similarly named keys', () => {
    const wranglerPath = join(projectDir, 'wrangler.toml');
    writeFileSync(wranglerPath, [
      'name = "synthetic-app"',
      '[vars]',
      'EXISTING = "yes"',
      '',
      '[env.staging.vars]',
      'CAPTCHA_SITE_KEY = "staging-site"',
      'CAPTCHA_HOSTNAMES = "staging.example.test"',
      '',
    ].join('\n'));

    injectCaptchaSiteKey(wranglerPath, 'production-site', ['api.example.test']);

    const content = readFileSync(wranglerPath, 'utf8');
    const rootVars = content.match(/\[vars\]\n([\s\S]*?)\n\[env\.staging\.vars\]/)?.[1] ?? '';
    expect(rootVars).toContain('CAPTCHA_SITE_KEY = "production-site"');
    expect(rootVars).toContain('CAPTCHA_HOSTNAMES = "api.example.test"');
    expect(content).toContain('[env.staging.vars]\nCAPTCHA_SITE_KEY = "staging-site"');
    expect(content).toContain('CAPTCHA_HOSTNAMES = "staging.example.test"');
  });

  it('fails before mutation when top-level vars use an inline table', () => {
    const wranglerPath = join(projectDir, 'wrangler.toml');
    const original = [
      'name = "synthetic-app"',
      'vars = { EXISTING = "yes" }',
      '',
    ].join('\n');
    writeFileSync(wranglerPath, original);

    expect(() => injectCaptchaSiteKey(
      wranglerPath,
      'production-site',
      ['api.example.test'],
    )).toThrow(/top-level inline\/dotted `vars`.*\[vars\]/i);
    expect(readFileSync(wranglerPath, 'utf8')).toBe(original);
  });
});
