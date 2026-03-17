/**
 * Email HTML templates for authentication flows.
 *
 * All 5 render functions accept an optional `locale` parameter (3rd argument)
 * for i18n support. When locale is provided (and no custom template override),
 * the built-in translated strings from email-translations.ts are used.
 *
 * Priority: custom template → built-in translation for locale → English default
 *
 * Users can override any template by providing custom HTML in `email.templates`
 * config with {{variable}} placeholders for dynamic values.
 */

import { getStrings } from './email-translations.js';

// ─── Shared Styles ───

const SHARED_STYLES = `
  body { margin: 0; padding: 0; background: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); overflow: hidden; }
  .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px 40px; }
  .header h1 { margin: 0; color: #ffffff; font-size: 24px; font-weight: 600; }
  .body { padding: 40px; color: #333; line-height: 1.6; }
  .body p { margin: 0 0 16px; }
  .btn { display: inline-block; background: #667eea; color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 16px; margin: 8px 0 24px; }
  .code { background: #f0f0f5; border: 1px solid #e0e0e8; border-radius: 6px; padding: 16px; text-align: center; font-size: 28px; font-weight: 700; letter-spacing: 4px; color: #333; margin: 8px 0 24px; }
  .footer { padding: 24px 40px; background: #f9f9fb; color: #888; font-size: 12px; text-align: center; border-top: 1px solid #eee; }
  .muted { color: #888; font-size: 13px; }
`;

// ─── Custom Template Renderer ───

/**
 * Replace {{varName}} placeholders with HTML-escaped values.
 * Unknown placeholders are left as-is.
 */
function renderCustomTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = vars[key as string];
    return val !== undefined ? escapeHtml(String(val)) : match;
  });
}

/**
 * Replace {{varName}} placeholders in a translation string.
 * Same as renderCustomTemplate but returns raw (not HTML-escaped) for use
 * inside already-safe template contexts. Values ARE escaped.
 */
function renderTranslationString(
  str: string,
  vars: Record<string, string | number>,
): string {
  return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = vars[key as string];
    return val !== undefined ? escapeHtml(String(val)) : match;
  });
}

// ─── Verify Email ───

export interface VerifyEmailVars {
  appName: string;
  verifyUrl: string;
  token: string;
  expiresInHours: number;
}

export function renderVerifyEmail(vars: VerifyEmailVars, customTemplate?: string, locale?: string): string {
  if (customTemplate) {
    return renderCustomTemplate(customTemplate, {
      appName: vars.appName,
      verifyUrl: vars.verifyUrl,
      token: vars.token,
      expiresInHours: vars.expiresInHours,
    });
  }

  const lang = locale || 'en';
  const s = getStrings(lang, 'verification');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${SHARED_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header"><h1>${escapeHtml(vars.appName)}</h1></div>
    <div class="body">
      <p>${escapeHtml(s.heading)}</p>
      <p>${escapeHtml(s.subheading ?? '')}</p>
      <p style="text-align:center"><a class="btn" href="${escapeHtml(vars.verifyUrl)}">${escapeHtml(s.cta ?? 'Verify Email')}</a></p>
      <p>${escapeHtml(s.tokenLabel ?? '')}</p>
      <div class="code">${escapeHtml(vars.token)}</div>
      <p class="muted">${renderTranslationString(s.expires, { expiresInHours: vars.expiresInHours })}</p>
      <p class="muted">${escapeHtml(s.ignore)}</p>
    </div>
    <div class="footer">&copy; ${escapeHtml(vars.appName)}</div>
  </div>
</body>
</html>`;
}

// ─── Password Reset ───

export interface PasswordResetVars {
  appName: string;
  resetUrl: string;
  token: string;
  expiresInMinutes: number;
}

export function renderPasswordReset(vars: PasswordResetVars, customTemplate?: string, locale?: string): string {
  if (customTemplate) {
    return renderCustomTemplate(customTemplate, {
      appName: vars.appName,
      resetUrl: vars.resetUrl,
      token: vars.token,
      expiresInMinutes: vars.expiresInMinutes,
    });
  }

  const lang = locale || 'en';
  const s = getStrings(lang, 'passwordReset');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${SHARED_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header"><h1>${escapeHtml(vars.appName)}</h1></div>
    <div class="body">
      <p>${escapeHtml(s.heading)}</p>
      <p>${escapeHtml(s.subheading ?? '')}</p>
      <p style="text-align:center"><a class="btn" href="${escapeHtml(vars.resetUrl)}">${escapeHtml(s.cta ?? 'Reset Password')}</a></p>
      <p>${escapeHtml(s.tokenLabel ?? '')}</p>
      <div class="code">${escapeHtml(vars.token)}</div>
      <p class="muted">${renderTranslationString(s.expires, { expiresInMinutes: vars.expiresInMinutes })}</p>
      <p class="muted">${escapeHtml(s.ignore)}</p>
    </div>
    <div class="footer">&copy; ${escapeHtml(vars.appName)}</div>
  </div>
</body>
</html>`;
}

// ─── Magic Link ───

export interface MagicLinkVars {
  appName: string;
  magicLinkUrl: string;
  expiresInMinutes: number;
}

export function renderMagicLink(vars: MagicLinkVars, customTemplate?: string, locale?: string): string {
  if (customTemplate) {
    return renderCustomTemplate(customTemplate, {
      appName: vars.appName,
      magicLinkUrl: vars.magicLinkUrl,
      expiresInMinutes: vars.expiresInMinutes,
    });
  }

  const lang = locale || 'en';
  const s = getStrings(lang, 'magicLink');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${SHARED_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header"><h1>${escapeHtml(vars.appName)}</h1></div>
    <div class="body">
      <p>${escapeHtml(s.heading)}</p>
      <p>${escapeHtml(s.subheading ?? '')}</p>
      <p style="text-align:center"><a class="btn" href="${escapeHtml(vars.magicLinkUrl)}">${escapeHtml(s.cta ?? 'Sign In')}</a></p>
      <p class="muted">${renderTranslationString(s.expires, { expiresInMinutes: vars.expiresInMinutes })}</p>
      <p class="muted">${escapeHtml(s.ignore)}</p>
    </div>
    <div class="footer">&copy; ${escapeHtml(vars.appName)}</div>
  </div>
</body>
</html>`;
}

// ─── Email OTP ───

export interface EmailOtpVars {
  appName: string;
  code: string;
  expiresInMinutes: number;
}

export function renderEmailOtp(vars: EmailOtpVars, customTemplate?: string, locale?: string): string {
  if (customTemplate) {
    return renderCustomTemplate(customTemplate, {
      appName: vars.appName,
      code: vars.code,
      expiresInMinutes: vars.expiresInMinutes,
    });
  }

  const lang = locale || 'en';
  const s = getStrings(lang, 'emailOtp');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${SHARED_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header"><h1>${escapeHtml(vars.appName)}</h1></div>
    <div class="body">
      <p>${escapeHtml(s.heading)}</p>
      <p>${escapeHtml(s.instruction ?? '')}</p>
      <div class="code">${escapeHtml(vars.code)}</div>
      <p class="muted">${renderTranslationString(s.expires, { expiresInMinutes: vars.expiresInMinutes })}</p>
      <p class="muted">${escapeHtml(s.ignore)}</p>
    </div>
    <div class="footer">&copy; ${escapeHtml(vars.appName)}</div>
  </div>
</body>
</html>`;
}

// ─── Email Change Verification ───

export interface EmailChangeVars {
  appName: string;
  verifyUrl: string;
  token: string;
  newEmail: string;
  expiresInHours: number;
}

export function renderEmailChange(vars: EmailChangeVars, customTemplate?: string, locale?: string): string {
  if (customTemplate) {
    return renderCustomTemplate(customTemplate, {
      appName: vars.appName,
      verifyUrl: vars.verifyUrl,
      token: vars.token,
      newEmail: vars.newEmail,
      expiresInHours: vars.expiresInHours,
    });
  }

  const lang = locale || 'en';
  const s = getStrings(lang, 'emailChange');

  // instruction contains <strong>{{newEmail}}</strong> — render with variable substitution (not full escape)
  const instructionHtml = s.instruction
    ? renderTranslationString(s.instruction, { newEmail: vars.newEmail })
    : `To change your email to <strong>${escapeHtml(vars.newEmail)}</strong>, click the button below:`;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${SHARED_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header"><h1>${escapeHtml(vars.appName)}</h1></div>
    <div class="body">
      <p>${escapeHtml(s.heading)}</p>
      <p>${instructionHtml}</p>
      <p style="text-align:center"><a class="btn" href="${escapeHtml(vars.verifyUrl)}">${escapeHtml(s.cta ?? 'Confirm Email Change')}</a></p>
      <p>${escapeHtml(s.tokenLabel ?? '')}</p>
      <div class="code">${escapeHtml(vars.token)}</div>
      <p class="muted">${renderTranslationString(s.expires, { expiresInHours: vars.expiresInHours })}</p>
      <p class="muted">${escapeHtml(s.ignore)}</p>
    </div>
    <div class="footer">&copy; ${escapeHtml(vars.appName)}</div>
  </div>
</body>
</html>`;
}

// ─── Helpers ───

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
