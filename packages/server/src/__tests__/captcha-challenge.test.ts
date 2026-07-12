import { afterEach, describe, expect, it } from 'vitest';
import { OpenAPIHono } from '../lib/hono.js';
import { setConfig } from '../lib/do-router.js';
import {
  buildCaptchaChallengeHtml,
  captchaChallengeRoute,
} from '../routes/captcha.js';
import type { Env } from '../types.js';

function createApp() {
  const app = new OpenAPIHono();
  app.route('/api/captcha', captchaChallengeRoute);
  return app;
}

afterEach(() => setConfig({}));

describe('hosted native Turnstile challenge', () => {
  it('serves a no-store, hostname-bound page with strict CSP and all supported bridges', async () => {
    setConfig({
      release: true,
      captcha: { siteKey: 'synthetic-site-key', hostnames: ['api.example.test'] },
    });

    const response = await createApp().request(
      'https://api.example.test/api/captcha/challenge?action=signup',
      { headers: {} },
      { TURNSTILE_SECRET: 'synthetic-secret-key' } as Env,
    );
    expect(response.status).toBe(400);

    const validResponse = await createApp().request(
      'https://api.example.test/api/captcha/challenge?action=signup&channel=0123456789abcdef0123456789abcdef&bridge=rn',
      undefined,
      { TURNSTILE_SECRET: 'synthetic-secret-key' } as Env,
    );
    const html = await validResponse.text();

    expect(validResponse.status).toBe(200);
    expect(validResponse.headers.get('content-type')).toContain('text/html');
    expect(validResponse.headers.get('cache-control')).toContain('no-store');
    expect(validResponse.headers.get('referrer-policy')).toBe('no-referrer');
    expect(validResponse.headers.get('x-content-type-options')).toBe('nosniff');
    const csp = validResponse.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('https://challenges.cloudflare.com');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(html).toContain('sitekey: "synthetic-site-key"');
    expect(html).toContain('action: "signup"');
    expect(html).toContain("case 'rn': window.ReactNativeWebView.postMessage(json)");
    expect(html).toContain("case 'webkit': window.webkit.messageHandlers.edgebaseCaptcha.postMessage(json)");
    expect(html).toContain("case 'android': window.EdgeBaseCaptchaBridge.postMessage(json)");
    expect(html).toContain("case 'flutter': window.flutter_inappwebview.callHandler('edgebaseCaptcha', json)");
    expect(html).toContain("case 'vuplex': window.vuplex.postMessage(json)");
    expect(html).toContain("case 'unity': window.Unity.call(json)");
    expect(html).toContain("case 'uri': window.location.href = 'edgebase://message/'");
    expect(html).toContain('const channel = "0123456789abcdef0123456789abcdef"');
    expect(html).toContain('const json = JSON.stringify({ v: 1, channel, type, value: text })');
    expect(html).toContain("value: 'bridge_unavailable'");
    expect(html).not.toContain('window.parent.postMessage');
    expect(html).not.toContain('synthetic-secret-key');
  });

  it('rejects unregistered request hostnames and invalid action/display parameters', async () => {
    setConfig({
      release: true,
      captcha: { siteKey: 'synthetic-site-key', hostnames: ['api.example.test'] },
    });
    const env = { TURNSTILE_SECRET: 'synthetic-secret-key' } as Env;

    const wrongHost = await createApp().request(
      'https://attacker.example/api/captcha/challenge?action=signin&channel=0123456789abcdef0123456789abcdef&bridge=webkit',
      undefined,
      env,
    );
    expect(wrongHost.status).toBe(403);

    const invalidAction = await createApp().request(
      'https://api.example.test/api/captcha/challenge?action=function:route-name&channel=0123456789abcdef0123456789abcdef&bridge=webkit',
      undefined,
      env,
    );
    expect(invalidAction.status).toBe(400);

    const invalidDisplay = await createApp().request(
      'https://api.example.test/api/captcha/challenge?action=function&appearance=attacker&channel=0123456789abcdef0123456789abcdef&bridge=webkit',
      undefined,
      env,
    );
    expect(invalidDisplay.status).toBe(400);

    const insecureRelease = await createApp().request(
      'http://api.example.test/api/captcha/challenge?action=function&channel=0123456789abcdef0123456789abcdef&bridge=webkit',
      undefined,
      env,
    );
    expect(insecureRelease.status).toBe(400);
  });

  it('returns 404 in local development when CAPTCHA is disabled', async () => {
    setConfig({ release: false, captcha: false });
    const response = await createApp().request(
      'http://localhost/api/captcha/challenge?action=signin&channel=0123456789abcdef0123456789abcdef&bridge=rn',
    );
    expect(response.status).toBe(404);
  });

  it('escapes config values before embedding them into executable HTML', () => {
    const html = buildCaptchaChallengeHtml({
      siteKey: '</script><script>attack()</script>',
      action: 'signup',
      appearance: 'interaction-only',
      size: 'normal',
      channel: '0123456789abcdef0123456789abcdef',
      bridge: 'rn',
      nonce: 'syntheticnonce',
    });

    expect(html).not.toContain('</script><script>attack()');
    expect(html).toContain('\\u003c/script>');
  });

  it('falls back to a channel-bound bridge error when the selected bridge throws', () => {
    const html = buildCaptchaChallengeHtml({
      siteKey: 'synthetic-site-key',
      action: 'signup',
      appearance: 'interaction-only',
      size: 'normal',
      channel: '0123456789abcdef0123456789abcdef',
      bridge: 'rn',
      nonce: 'syntheticnonce',
    });
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    const inlineScript = scripts.at(-1)?.[1];
    expect(inlineScript).toBeTruthy();
    let renderOptions: Record<string, (...args: string[]) => void> | undefined;
    const mockWindow = {
      ReactNativeWebView: { postMessage: () => { throw new Error('bridge unavailable'); } },
      location: { href: '', origin: 'https://api.example.test' },
      setTimeout: (callback: () => void, delay: number) => {
        if (delay < 15_000) callback();
        return 1;
      },
      turnstile: {
        render: (_selector: string, options: Record<string, (...args: string[]) => void>) => {
          renderOptions = options;
          options.callback?.('synthetic-token');
        },
      },
    };

    Function('window', inlineScript!)(mockWindow);

    expect(renderOptions).toBeTruthy();
    expect(mockWindow.location.href).toMatch(/^edgebase:\/\/message\//);
    const payload = JSON.parse(decodeURIComponent(
      mockWindow.location.href.replace('edgebase://message/', ''),
    )) as Record<string, unknown>;
    expect(payload).toEqual({
      v: 1,
      channel: '0123456789abcdef0123456789abcdef',
      type: 'error',
      value: 'bridge_unavailable',
    });
  });

  it('delivers one terminal error when Turnstile render throws synchronously', () => {
    const html = buildCaptchaChallengeHtml({
      siteKey: 'synthetic-site-key',
      action: 'signin',
      appearance: 'interaction-only',
      size: 'normal',
      channel: '0123456789abcdef0123456789abcdef',
      bridge: 'rn',
      nonce: 'syntheticnonce',
    });
    const inlineScript = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
    const messages: string[] = [];
    const mockWindow = {
      ReactNativeWebView: { postMessage: (message: string) => messages.push(message) },
      location: { href: '', origin: 'https://api.example.test' },
      setTimeout: (callback: () => void, delay: number) => {
        if (delay < 15_000) callback();
        return 1;
      },
      turnstile: { render: () => { throw new Error('synthetic render failure'); } },
    };

    Function('window', inlineScript!)(mockWindow);

    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0]!)).toMatchObject({
      type: 'error',
      value: 'render_failed',
      channel: '0123456789abcdef0123456789abcdef',
    });
  });
});
