import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { npxCommand } from './npx.js';
import { listWranglerSecretNames } from './wrangler-secrets.js';

export interface TurnstileProvisionResult {
  siteKey: string;
  secretKey: string;
  widgetName?: string;
  managed: boolean;
  source: 'manual' | 'created' | 'existing';
}

/**
 * Provision Cloudflare Turnstile widget via Management API.
 * If config.captcha === true: auto-create widget, store secret.
 * If config.captcha is CaptchaConfig: use provided keys.
 *
 * @returns { siteKey, secretKey } or null if captcha not configured.
 */
export async function provisionTurnstile(
  captchaConfig: boolean | { siteKey: string; secretKey: string } | undefined,
  projectDir: string,
  _configJson: Record<string, unknown>,
  knownAccountId?: string,
): Promise<TurnstileProvisionResult | null> {
  if (!captchaConfig) return null;

  if (typeof captchaConfig === 'object') {
    console.log(chalk.green('✓'), 'Captcha: using manual siteKey/secretKey');
    return {
      siteKey: captchaConfig.siteKey,
      secretKey: captchaConfig.secretKey,
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
        const match = content.match(/account_id\s*=\s*"([^"]+)"/);
        return match?.[1];
      }
      return undefined;
    })();

  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!cfAccountId || !apiToken) {
    console.log(
      chalk.yellow('⚠'),
      'Turnstile auto-provisioning requires CLOUDFLARE_API_TOKEN env var.',
    );
    console.log(chalk.dim('  Set captcha to { siteKey, secretKey } in config for manual mode.'));
    return null;
  }

  let projectName = 'edgebase';
  const wranglerPath = join(projectDir, 'wrangler.toml');
  if (existsSync(wranglerPath)) {
    const content = readFileSync(wranglerPath, 'utf-8');
    const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
    if (nameMatch) projectName = nameMatch[1];
  }
  const widgetName = `${projectName}-captcha`;

  try {
    const listResp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/challenges/widgets`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    const listResult = (await listResp.json()) as {
      result?: Array<{ name: string; sitekey: string; secret: string }>;
      success?: boolean;
    };
    const widgets = listResult?.result ?? [];
    const existing = widgets.find((w: { name: string }) => w.name === widgetName);

    if (existing) {
      console.log(
        chalk.dim(
          `  Turnstile widget '${widgetName}': already exists → ${existing.sitekey.slice(0, 8)}…`,
        ),
      );

      storeSecretIfMissing(projectDir, 'TURNSTILE_SECRET', existing.secret);

      return {
        siteKey: existing.sitekey,
        secretKey: existing.secret,
        widgetName,
        managed: true,
        source: 'existing',
      };
    }

    const createResp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/challenges/widgets`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: widgetName, domains: ['*'], mode: 'managed' }),
      },
    );
    const createResult = (await createResp.json()) as {
      success?: boolean;
      result?: { sitekey: string; secret: string };
      errors?: Array<{ message: string }>;
    };
    if (createResult?.success && createResult.result) {
      const { sitekey, secret } = createResult.result;
      console.log(
        chalk.green('✓'),
        `Turnstile widget '${widgetName}': created → ${sitekey.slice(0, 8)}…`,
      );

      storeSecretIfMissing(projectDir, 'TURNSTILE_SECRET', secret);

      return {
        siteKey: sitekey,
        secretKey: secret,
        widgetName,
        managed: true,
        source: 'created',
      };
    }

    const errors =
      createResult?.errors?.map((e: { message: string }) => e.message).join(', ') ??
      'unknown error';
    console.log(chalk.yellow('⚠'), `Turnstile widget creation failed: ${errors}`);
    diagnoseTurnstileError(errors);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow('⚠'), `Turnstile provisioning failed: ${msg}`);
    diagnoseTurnstileError(msg);
    return null;
  }
}

function diagnoseTurnstileError(errorMessage: string): void {
  const msg = errorMessage.toLowerCase();
  if (msg.includes('not enabled') || msg.includes('not found') || msg.includes('code: 10042')) {
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
 * Store a Workers secret if not already set.
 */
export function storeSecretIfMissing(
  projectDir: string,
  secretName: string,
  secretValue: string,
): void {
  try {
    const secretNames = listWranglerSecretNames(projectDir);
    if (!secretNames.has(secretName)) {
      execFileSync(npxCommand(), ['wrangler', 'secret', 'put', secretName], {
        cwd: projectDir,
        input: secretValue,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log(chalk.green('✓'), `${secretName} stored as Workers secret.`);
    }
  } catch {
    console.log(
      chalk.yellow('⚠'),
      `Could not store ${secretName} as Workers secret. Set it manually via: npx wrangler secret put ${secretName}`,
    );
  }
}

/**
 * Inject captcha siteKey as a standalone CAPTCHA_SITE_KEY variable in wrangler.toml [vars].
 */
export function injectCaptchaSiteKey(wranglerPath: string, siteKey: string): void {
  if (!existsSync(wranglerPath)) return;

  let content = readFileSync(wranglerPath, 'utf-8');

  try {
    if (content.includes('CAPTCHA_SITE_KEY')) {
      content = content.replace(
        /CAPTCHA_SITE_KEY\s*=\s*"[^"]*"/,
        `CAPTCHA_SITE_KEY = "${siteKey}"`,
      );
    } else if (content.includes('[vars]')) {
      content = content.replace('[vars]', `[vars]\nCAPTCHA_SITE_KEY = "${siteKey}"`);
    } else {
      content += `\n[vars]\nCAPTCHA_SITE_KEY = "${siteKey}"\n`;
    }
    writeFileSync(wranglerPath, content, 'utf-8');
    console.log(chalk.green('✓'), 'Captcha siteKey injected as CAPTCHA_SITE_KEY in wrangler.toml');
  } catch {
    console.log(chalk.yellow('⚠'), 'Could not inject CAPTCHA_SITE_KEY into wrangler.toml');
  }
}
