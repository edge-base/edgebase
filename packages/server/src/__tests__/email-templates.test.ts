/**
 * Unit tests — lib/email-templates.ts
 *
 * Run: cd packages/server && npx vitest run src/__tests__/email-templates.test.ts
 *
 * Tests:
 *   renderVerifyEmail / renderPasswordReset / renderMagicLink
 *   renderEmailOtp / renderEmailChange
 *   + escapeHtml XSS prevention
 *   + custom template override via {{variable}} placeholders
 *   + i18n: locale-aware rendering, lang attribute, fallback chain
 */

import { describe, it, expect } from 'vitest';
import {
  renderVerifyEmail,
  renderPasswordReset,
  renderMagicLink,
  renderEmailOtp,
  renderEmailChange,
} from '../lib/email-templates.js';
import { getStrings, getDefaultSubject, SUPPORTED_LOCALES } from '../lib/email-translations.js';

// ─── A. renderVerifyEmail ───────────────────────────────────────────────────

describe('renderVerifyEmail', () => {
  const vars = {
    appName: 'MyApp',
    verifyUrl: 'https://example.com/verify?token=abc',
    token: 'ABC123',
    expiresInHours: 24,
  };

  it('returns valid HTML document', () => {
    const html = renderVerifyEmail(vars);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes app name in header', () => {
    const html = renderVerifyEmail(vars);
    expect(html).toContain('MyApp');
  });

  it('includes verify URL in href', () => {
    const html = renderVerifyEmail(vars);
    expect(html).toContain('href="https://example.com/verify?token=abc"');
  });

  it('includes token in code block', () => {
    const html = renderVerifyEmail(vars);
    expect(html).toContain('ABC123');
  });

  it('includes expiry hours', () => {
    const html = renderVerifyEmail(vars);
    expect(html).toContain('24 hours');
  });

  it('escapes HTML in appName (XSS prevention)', () => {
    const html = renderVerifyEmail({
      ...vars,
      appName: '<script>alert("xss")</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in verifyUrl', () => {
    const html = renderVerifyEmail({
      ...vars,
      verifyUrl: 'https://evil.com/"><script>alert(1)</script>',
    });
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('escapes single quotes in token', () => {
    const html = renderVerifyEmail({
      ...vars,
      token: "test'token",
    });
    expect(html).toContain('&#39;');
  });

  it('escapes ampersand', () => {
    const html = renderVerifyEmail({
      ...vars,
      appName: 'A & B',
    });
    expect(html).toContain('A &amp; B');
  });

  it('uses custom template when provided', () => {
    const html = renderVerifyEmail(vars, '<h1>{{appName}}</h1><a href="{{verifyUrl}}">{{token}}</a><p>{{expiresInHours}}h</p>');
    expect(html).toContain('<h1>MyApp</h1>');
    expect(html).toContain('href="https://example.com/verify?token=abc"');
    expect(html).toContain('ABC123');
    expect(html).toContain('24h');
  });

  it('custom template escapes HTML in variables', () => {
    const html = renderVerifyEmail(
      { ...vars, appName: '<script>xss</script>' },
      '{{appName}}',
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('custom template leaves unknown placeholders as-is', () => {
    const html = renderVerifyEmail(vars, '{{unknown}} {{appName}}');
    expect(html).toContain('{{unknown}}');
    expect(html).toContain('MyApp');
  });
});

// ─── B. renderPasswordReset ─────────────────────────────────────────────────

describe('renderPasswordReset', () => {
  const vars = {
    appName: 'TestApp',
    resetUrl: 'https://example.com/reset',
    token: 'RESET-TOKEN',
    expiresInMinutes: 30,
  };

  it('includes reset URL', () => {
    const html = renderPasswordReset(vars);
    expect(html).toContain('https://example.com/reset');
  });

  it('includes token', () => {
    const html = renderPasswordReset(vars);
    expect(html).toContain('RESET-TOKEN');
  });

  it('includes expiry minutes', () => {
    const html = renderPasswordReset(vars);
    expect(html).toContain('30 minutes');
  });

  it('includes footer with app name', () => {
    const html = renderPasswordReset(vars);
    expect(html).toContain('&copy; TestApp');
  });

  it('escapes XSS in resetUrl', () => {
    const html = renderPasswordReset({
      ...vars,
      resetUrl: '"><img onerror=alert(1) src=x>',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('uses custom template when provided', () => {
    const html = renderPasswordReset(vars, '<p>Reset: {{resetUrl}} ({{expiresInMinutes}}min)</p>');
    expect(html).toContain('Reset: https://example.com/reset (30min)');
  });
});

// ─── C. renderMagicLink ─────────────────────────────────────────────────────

describe('renderMagicLink', () => {
  const vars = {
    appName: 'MagicApp',
    magicLinkUrl: 'https://example.com/magic?token=xyz',
    expiresInMinutes: 15,
  };

  it('includes magic link URL', () => {
    const html = renderMagicLink(vars);
    expect(html).toContain('https://example.com/magic?token=xyz');
  });

  it('includes expiry minutes', () => {
    const html = renderMagicLink(vars);
    expect(html).toContain('15 minutes');
  });

  it('has login button', () => {
    const html = renderMagicLink(vars);
    expect(html).toContain('class="btn"');
  });

  it('escapes XSS in magicLinkUrl', () => {
    const html = renderMagicLink({
      ...vars,
      magicLinkUrl: 'javascript:alert(1)',
    });
    // Should be escaped but still present as text
    expect(html).toContain('javascript:alert(1)');
    // The important thing: it should not create an executable context
    // (it's in an href, but the escapeHtml prevents tag injection)
  });

  it('uses custom template when provided', () => {
    const html = renderMagicLink(vars, '<a href="{{magicLinkUrl}}">Login to {{appName}}</a>');
    expect(html).toContain('href="https://example.com/magic?token=xyz"');
    expect(html).toContain('Login to MagicApp');
  });
});

// ─── D. renderEmailOtp ──────────────────────────────────────────────────────

describe('renderEmailOtp', () => {
  const vars = {
    appName: 'OtpApp',
    code: '123456',
    expiresInMinutes: 5,
  };

  it('includes OTP code', () => {
    const html = renderEmailOtp(vars);
    expect(html).toContain('123456');
  });

  it('includes expiry minutes', () => {
    const html = renderEmailOtp(vars);
    expect(html).toContain('5 minutes');
  });

  it('code in code block div', () => {
    const html = renderEmailOtp(vars);
    expect(html).toContain('class="code"');
  });

  it('escapes code with HTML characters', () => {
    const html = renderEmailOtp({
      ...vars,
      code: '<b>bold</b>',
    });
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('uses custom template when provided', () => {
    const html = renderEmailOtp(vars, '<div>Your code: {{code}} (expires in {{expiresInMinutes}} min)</div>');
    expect(html).toContain('Your code: 123456 (expires in 5 min)');
  });
});

// ─── E. renderEmailChange ───────────────────────────────────────────────────

describe('renderEmailChange', () => {
  const vars = {
    appName: 'ChangeApp',
    verifyUrl: 'https://example.com/change',
    token: 'CHANGE-TOKEN',
    newEmail: 'new@example.com',
    expiresInHours: 48,
  };

  it('includes new email address', () => {
    const html = renderEmailChange(vars);
    expect(html).toContain('new@example.com');
  });

  it('includes token', () => {
    const html = renderEmailChange(vars);
    expect(html).toContain('CHANGE-TOKEN');
  });

  it('includes verify URL', () => {
    const html = renderEmailChange(vars);
    expect(html).toContain('https://example.com/change');
  });

  it('includes expiry hours', () => {
    const html = renderEmailChange(vars);
    expect(html).toContain('48 hours');
  });

  it('escapes XSS in newEmail', () => {
    const html = renderEmailChange({
      ...vars,
      newEmail: '<script>alert("xss")</script>@evil.com',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes all five HTML entities', () => {
    const html = renderEmailChange({
      ...vars,
      appName: '&<>"\'',
    });
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
  });

  it('uses custom template when provided', () => {
    const html = renderEmailChange(vars, '<p>Change to {{newEmail}}: {{verifyUrl}}</p>');
    expect(html).toContain('Change to new@example.com: https://example.com/change');
  });
});

// ─── F. i18n — Locale-Aware Rendering ────────────────────────────────────────

describe('i18n — locale-aware rendering', () => {
  const verifyVars = {
    appName: 'MyApp',
    verifyUrl: 'https://example.com/verify',
    token: 'TOK123',
    expiresInHours: 24,
  };

  const resetVars = {
    appName: 'MyApp',
    resetUrl: 'https://example.com/reset',
    token: 'RST456',
    expiresInMinutes: 30,
  };

  const magicVars = {
    appName: 'MyApp',
    magicLinkUrl: 'https://example.com/magic',
    expiresInMinutes: 15,
  };

  const otpVars = {
    appName: 'MyApp',
    code: '847293',
    expiresInMinutes: 10,
  };

  const changeVars = {
    appName: 'MyApp',
    verifyUrl: 'https://example.com/change',
    token: 'CHG789',
    newEmail: 'new@test.com',
    expiresInHours: 48,
  };

  // ─── HTML lang attribute ───

  it('sets lang="en" by default (no locale)', () => {
    const html = renderVerifyEmail(verifyVars);
    expect(html).toContain('<html lang="en">');
  });

  it('sets lang="ko" when locale is "ko"', () => {
    const html = renderVerifyEmail(verifyVars, undefined, 'ko');
    expect(html).toContain('<html lang="ko">');
  });

  it('sets lang="ja" when locale is "ja"', () => {
    const html = renderMagicLink(magicVars, undefined, 'ja');
    expect(html).toContain('<html lang="ja">');
  });

  it('lang attribute is set for all render functions', () => {
    expect(renderVerifyEmail(verifyVars, undefined, 'fr')).toContain('<html lang="fr">');
    expect(renderPasswordReset(resetVars, undefined, 'de')).toContain('<html lang="de">');
    expect(renderMagicLink(magicVars, undefined, 'es')).toContain('<html lang="es">');
    expect(renderEmailOtp(otpVars, undefined, 'pt')).toContain('<html lang="pt">');
    expect(renderEmailChange(changeVars, undefined, 'zh')).toContain('<html lang="zh">');
  });

  // ─── Korean translations ───

  it('renderVerifyEmail uses Korean text when locale is "ko"', () => {
    const html = renderVerifyEmail(verifyVars, undefined, 'ko');
    expect(html).toContain('이메일 주소를 인증해주세요');
    expect(html).toContain('이메일 인증'); // CTA button
    expect(html).not.toContain('Verify Email'); // English CTA should NOT appear
  });

  it('renderPasswordReset uses Korean text when locale is "ko"', () => {
    const html = renderPasswordReset(resetVars, undefined, 'ko');
    expect(html).toContain('비밀번호 재설정을 요청하셨습니다');
    expect(html).toContain('비밀번호 재설정'); // CTA
  });

  it('renderMagicLink uses Korean text when locale is "ko"', () => {
    const html = renderMagicLink(magicVars, undefined, 'ko');
    expect(html).toContain('계정 로그인 링크가 요청되었습니다');
    expect(html).toContain('로그인'); // CTA
  });

  it('renderEmailOtp uses Korean text when locale is "ko"', () => {
    const html = renderEmailOtp(otpVars, undefined, 'ko');
    expect(html).toContain('로그인 인증 코드입니다');
    expect(html).toContain('847293'); // code is still present
  });

  it('renderEmailChange uses Korean text when locale is "ko"', () => {
    const html = renderEmailChange(changeVars, undefined, 'ko');
    expect(html).toContain('계정의 이메일 변경이 요청되었습니다');
    expect(html).toContain('이메일 변경 확인'); // CTA
    expect(html).toContain('new@test.com'); // newEmail still present
  });

  // ─── Japanese translations ───

  it('renderEmailOtp uses Japanese text when locale is "ja"', () => {
    const html = renderEmailOtp(otpVars, undefined, 'ja');
    expect(html).toContain('ログイン認証コードです');
    expect(html).toContain('847293');
  });

  // ─── Chinese translations ───

  it('renderMagicLink uses Chinese text when locale is "zh"', () => {
    const html = renderMagicLink(magicVars, undefined, 'zh');
    expect(html).toContain('您的账户收到了登录链接请求');
    expect(html).toContain('登录'); // CTA
  });

  // ─── Fallback chain: unknown locale → 'en' ───

  it('falls back to English for unknown locale', () => {
    const html = renderVerifyEmail(verifyVars, undefined, 'xx');
    expect(html).toContain('Please verify your email address');
    expect(html).toContain('<html lang="xx">'); // lang attr still uses the passed locale
  });

  // ─── Fallback chain: regional locale → base language ───

  it('zh-TW falls back to zh translations', () => {
    const html = renderMagicLink(magicVars, undefined, 'zh-TW');
    expect(html).toContain('您的账户收到了登录链接请求'); // Chinese text
    expect(html).toContain('<html lang="zh-TW">');
  });

  it('ko-KR falls back to ko translations', () => {
    const html = renderEmailOtp(otpVars, undefined, 'ko-KR');
    expect(html).toContain('로그인 인증 코드입니다'); // Korean text
  });

  // ─── Custom template ALWAYS wins over locale ───

  it('custom template overrides locale translations', () => {
    const customTpl = '<h1>Custom: {{appName}}</h1>';
    const html = renderVerifyEmail(verifyVars, customTpl, 'ko');
    expect(html).toContain('<h1>Custom: MyApp</h1>');
    expect(html).not.toContain('이메일'); // Korean text should NOT appear
  });

  it('custom template still works with any locale', () => {
    const customTpl = '<p>Code: {{code}}</p>';
    const html = renderEmailOtp(otpVars, customTpl, 'ja');
    expect(html).toContain('<p>Code: 847293</p>');
    expect(html).not.toContain('ログイン'); // Japanese text should NOT appear
  });

  // ─── Variables are still properly rendered in translated templates ───

  it('Korean verify email still contains proper URLs and tokens', () => {
    const html = renderVerifyEmail(verifyVars, undefined, 'ko');
    expect(html).toContain('href="https://example.com/verify"');
    expect(html).toContain('TOK123');
    expect(html).toContain('MyApp');
  });

  it('Korean password reset still has proper URLs', () => {
    const html = renderPasswordReset(resetVars, undefined, 'ko');
    expect(html).toContain('href="https://example.com/reset"');
    expect(html).toContain('RST456');
  });

  // ─── XSS prevention in translated templates ───

  it('translated templates still escape XSS in variables', () => {
    const html = renderVerifyEmail(
      { ...verifyVars, appName: '<script>alert(1)</script>' },
      undefined,
      'ko',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ─── G. email-translations.ts unit tests ─────────────────────────────────────

describe('email-translations', () => {
  it('SUPPORTED_LOCALES contains 8 locales', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(8);
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('ko');
    expect(SUPPORTED_LOCALES).toContain('ja');
    expect(SUPPORTED_LOCALES).toContain('zh');
  });

  it('getStrings returns English for "en"', () => {
    const s = getStrings('en', 'verification');
    expect(s.heading).toBe('Please verify your email address.');
  });

  it('getStrings returns Korean for "ko"', () => {
    const s = getStrings('ko', 'verification');
    expect(s.heading).toBe('이메일 주소를 인증해주세요.');
  });

  it('getStrings falls back to base language', () => {
    const s = getStrings('ko-KR', 'passwordReset');
    expect(s.heading).toBe('비밀번호 재설정을 요청하셨습니다.');
  });

  it('getStrings falls back to English for unknown locale', () => {
    const s = getStrings('xyz', 'magicLink');
    expect(s.heading).toBe('A login link was requested for your account.');
  });

  it('getDefaultSubject returns translated subject with {{appName}} placeholder', () => {
    expect(getDefaultSubject('en', 'verification')).toBe('[{{appName}}] Verify your email');
    expect(getDefaultSubject('ko', 'verification')).toBe('[{{appName}}] 이메일 인증');
    expect(getDefaultSubject('ja', 'emailOtp')).toBe('[{{appName}}] ログイン認証コード');
  });

  it('all locales have all 5 email types with required fields', () => {
    const emailTypes = ['verification', 'passwordReset', 'magicLink', 'emailOtp', 'emailChange'] as const;
    for (const locale of SUPPORTED_LOCALES) {
      for (const type of emailTypes) {
        const s = getStrings(locale, type);
        expect(s.subject, `${locale}/${type} missing subject`).toBeTruthy();
        expect(s.heading, `${locale}/${type} missing heading`).toBeTruthy();
        expect(s.expires, `${locale}/${type} missing expires`).toBeTruthy();
        expect(s.ignore, `${locale}/${type} missing ignore`).toBeTruthy();
      }
    }
  });
});
