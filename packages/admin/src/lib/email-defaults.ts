/**
 * Default email templates and subjects for the Email Templates editor.
 * These match the built-in templates in packages/server/src/lib/email-templates.ts.
 *
 * Includes i18n support: per-locale default subjects and templates
 * generated from the same translation strings as the server.
 */

export type EmailType = 'verification' | 'passwordReset' | 'magicLink' | 'emailOtp' | 'emailChange';

export const EMAIL_TYPES: { id: EmailType; label: string }[] = [
	{ id: 'verification', label: 'Verification' },
	{ id: 'passwordReset', label: 'Password Reset' },
	{ id: 'magicLink', label: 'Magic Link' },
	{ id: 'emailOtp', label: 'Email OTP' },
	{ id: 'emailChange', label: 'Email Change' },
];

// ─── Supported Locales ───

export const SUPPORTED_LOCALES: { code: string; label: string }[] = [
	{ code: 'en', label: 'English' },
	{ code: 'ko', label: '한국어' },
	{ code: 'ja', label: '日本語' },
	{ code: 'zh', label: '中文' },
	{ code: 'es', label: 'Español' },
	{ code: 'fr', label: 'Français' },
	{ code: 'de', label: 'Deutsch' },
	{ code: 'pt', label: 'Português' },
];

// ─── Translation Strings (mirrors server email-translations.ts) ───

interface EmailStrings {
	subject: string;
	heading: string;
	subheading?: string;
	cta?: string;
	tokenLabel?: string;
	instruction?: string;
	expires: string;
	ignore: string;
}

const translations: Record<string, Record<EmailType, EmailStrings>> = {
	en: {
		verification: {
			subject: '[{{appName}}] Verify your email',
			heading: 'Please verify your email address.',
			subheading: 'Click the button below or enter the verification code to verify your email:',
			cta: 'Verify Email',
			tokenLabel: 'Or enter the verification token manually:',
			expires: 'This link expires in {{expiresInHours}} hours.',
			ignore: "If you didn't request this, please ignore this email.",
		},
		passwordReset: {
			subject: '[{{appName}}] Reset your password',
			heading: 'You requested a password reset.',
			subheading: 'Click the button below to set a new password:',
			cta: 'Reset Password',
			tokenLabel: 'Or enter the reset token manually:',
			expires: 'This link expires in {{expiresInMinutes}} minutes.',
			ignore: "If you didn't request this, please ignore this email. Your password will not be changed.",
		},
		magicLink: {
			subject: '[{{appName}}] Your login link',
			heading: 'A login link was requested for your account.',
			subheading: 'Click the button below to sign in:',
			cta: 'Sign In',
			expires: 'This link expires in {{expiresInMinutes}} minutes.',
			ignore: "If you didn't request this, please ignore this email.",
		},
		emailOtp: {
			subject: '[{{appName}}] Your login code',
			heading: 'Here is your login verification code.',
			instruction: 'Enter the code below to complete your sign-in:',
			expires: 'This code expires in {{expiresInMinutes}} minutes.',
			ignore: "If you didn't request this, please ignore this email.",
		},
		emailChange: {
			subject: '[{{appName}}] Confirm email change',
			heading: 'An email address change was requested for your account.',
			instruction: 'To change your email to <strong>{{newEmail}}</strong>, click the button below:',
			cta: 'Confirm Email Change',
			tokenLabel: 'Or enter the verification token manually:',
			expires: 'This link expires in {{expiresInHours}} hours.',
			ignore: "If you didn't request this, please ignore this email. Your email address will not be changed.",
		},
	},
	ko: {
		verification: {
			subject: '[{{appName}}] 이메일 인증',
			heading: '이메일 주소를 인증해주세요.',
			subheading: '아래 버튼을 클릭하거나 인증 코드를 입력하여 이메일을 인증하세요:',
			cta: '이메일 인증',
			tokenLabel: '또는 인증 코드를 직접 입력하세요:',
			expires: '이 링크는 {{expiresInHours}}시간 후에 만료됩니다.',
			ignore: '요청하지 않으셨다면 이 이메일을 무시하세요.',
		},
		passwordReset: {
			subject: '[{{appName}}] 비밀번호 재설정',
			heading: '비밀번호 재설정을 요청하셨습니다.',
			subheading: '아래 버튼을 클릭하여 새 비밀번호를 설정하세요:',
			cta: '비밀번호 재설정',
			tokenLabel: '또는 재설정 코드를 직접 입력하세요:',
			expires: '이 링크는 {{expiresInMinutes}}분 후에 만료됩니다.',
			ignore: '요청하지 않으셨다면 이 이메일을 무시하세요. 비밀번호는 변경되지 않습니다.',
		},
		magicLink: {
			subject: '[{{appName}}] 로그인 링크',
			heading: '계정 로그인 링크가 요청되었습니다.',
			subheading: '아래 버튼을 클릭하여 로그인하세요:',
			cta: '로그인',
			expires: '이 링크는 {{expiresInMinutes}}분 후에 만료됩니다.',
			ignore: '요청하지 않으셨다면 이 이메일을 무시하세요.',
		},
		emailOtp: {
			subject: '[{{appName}}] 로그인 인증 코드',
			heading: '로그인 인증 코드입니다.',
			instruction: '아래 코드를 입력하여 로그인을 완료하세요:',
			expires: '이 코드는 {{expiresInMinutes}}분 후에 만료됩니다.',
			ignore: '요청하지 않으셨다면 이 이메일을 무시하세요.',
		},
		emailChange: {
			subject: '[{{appName}}] 이메일 변경 확인',
			heading: '계정의 이메일 변경이 요청되었습니다.',
			instruction: '이메일을 <strong>{{newEmail}}</strong>(으)로 변경하려면 아래 버튼을 클릭하세요:',
			cta: '이메일 변경 확인',
			tokenLabel: '또는 인증 코드를 직접 입력하세요:',
			expires: '이 링크는 {{expiresInHours}}시간 후에 만료됩니다.',
			ignore: '요청하지 않으셨다면 이 이메일을 무시하세요. 이메일 주소는 변경되지 않습니다.',
		},
	},
	ja: {
		verification: {
			subject: '[{{appName}}] メール認証',
			heading: 'メールアドレスを認証してください。',
			subheading: '下のボタンをクリックするか、認証コードを入力してメールを認証してください:',
			cta: 'メール認証',
			tokenLabel: 'または認証コードを直接入力してください:',
			expires: 'このリンクは{{expiresInHours}}時間後に期限切れになります。',
			ignore: 'リクエストしていない場合は、このメールを無視してください。',
		},
		passwordReset: {
			subject: '[{{appName}}] パスワードリセット',
			heading: 'パスワードリセットがリクエストされました。',
			subheading: '下のボタンをクリックして新しいパスワードを設定してください:',
			cta: 'パスワードリセット',
			tokenLabel: 'またはリセットコードを直接入力してください:',
			expires: 'このリンクは{{expiresInMinutes}}分後に期限切れになります。',
			ignore: 'リクエストしていない場合は、このメールを無視してください。パスワードは変更されません。',
		},
		magicLink: {
			subject: '[{{appName}}] ログインリンク',
			heading: 'アカウントのログインリンクがリクエストされました。',
			subheading: '下のボタンをクリックしてログインしてください:',
			cta: 'ログイン',
			expires: 'このリンクは{{expiresInMinutes}}分後に期限切れになります。',
			ignore: 'リクエストしていない場合は、このメールを無視してください。',
		},
		emailOtp: {
			subject: '[{{appName}}] ログイン認証コード',
			heading: 'ログイン認証コードです。',
			instruction: '下のコードを入力してログインを完了してください:',
			expires: 'このコードは{{expiresInMinutes}}分後に期限切れになります。',
			ignore: 'リクエストしていない場合は、このメールを無視してください。',
		},
		emailChange: {
			subject: '[{{appName}}] メール変更の確認',
			heading: 'アカウントのメールアドレス変更がリクエストされました。',
			instruction: 'メールを<strong>{{newEmail}}</strong>に変更するには、下のボタンをクリックしてください:',
			cta: 'メール変更を確認',
			tokenLabel: 'または認証コードを直接入力してください:',
			expires: 'このリンクは{{expiresInHours}}時間後に期限切れになります。',
			ignore: 'リクエストしていない場合は、このメールを無視してください。メールアドレスは変更されません。',
		},
	},
	zh: {
		verification: {
			subject: '[{{appName}}] 邮箱验证',
			heading: '请验证您的邮箱地址。',
			subheading: '点击下面的按钮或输入验证码来验证您的邮箱:',
			cta: '验证邮箱',
			tokenLabel: '或手动输入验证码:',
			expires: '此链接将在{{expiresInHours}}小时后过期。',
			ignore: '如果您没有发起此请求，请忽略此邮件。',
		},
		passwordReset: {
			subject: '[{{appName}}] 重置密码',
			heading: '您请求了密码重置。',
			subheading: '点击下面的按钮设置新密码:',
			cta: '重置密码',
			tokenLabel: '或手动输入重置码:',
			expires: '此链接将在{{expiresInMinutes}}分钟后过期。',
			ignore: '如果您没有发起此请求，请忽略此邮件。您的密码不会被更改。',
		},
		magicLink: {
			subject: '[{{appName}}] 登录链接',
			heading: '您的账户收到了登录链接请求。',
			subheading: '点击下面的按钮登录:',
			cta: '登录',
			expires: '此链接将在{{expiresInMinutes}}分钟后过期。',
			ignore: '如果您没有发起此请求，请忽略此邮件。',
		},
		emailOtp: {
			subject: '[{{appName}}] 登录验证码',
			heading: '以下是您的登录验证码。',
			instruction: '输入以下验证码完成登录:',
			expires: '此验证码将在{{expiresInMinutes}}分钟后过期。',
			ignore: '如果您没有发起此请求，请忽略此邮件。',
		},
		emailChange: {
			subject: '[{{appName}}] 确认更改邮箱',
			heading: '您的账户请求了邮箱地址更改。',
			instruction: '要将邮箱更改为<strong>{{newEmail}}</strong>，请点击下面的按钮:',
			cta: '确认更改邮箱',
			tokenLabel: '或手动输入验证码:',
			expires: '此链接将在{{expiresInHours}}小时后过期。',
			ignore: '如果您没有发起此请求，请忽略此邮件。您的邮箱地址不会被更改。',
		},
	},
	es: {
		verification: {
			subject: '[{{appName}}] Verifica tu correo',
			heading: 'Por favor verifica tu dirección de correo electrónico.',
			subheading: 'Haz clic en el botón de abajo o ingresa el código de verificación:',
			cta: 'Verificar correo',
			tokenLabel: 'O ingresa el código de verificación manualmente:',
			expires: 'Este enlace expira en {{expiresInHours}} horas.',
			ignore: 'Si no solicitaste esto, ignora este correo.',
		},
		passwordReset: {
			subject: '[{{appName}}] Restablecer contraseña',
			heading: 'Solicitaste un restablecimiento de contraseña.',
			subheading: 'Haz clic en el botón de abajo para establecer una nueva contraseña:',
			cta: 'Restablecer contraseña',
			tokenLabel: 'O ingresa el código de restablecimiento manualmente:',
			expires: 'Este enlace expira en {{expiresInMinutes}} minutos.',
			ignore: 'Si no solicitaste esto, ignora este correo. Tu contraseña no será modificada.',
		},
		magicLink: {
			subject: '[{{appName}}] Tu enlace de inicio de sesión',
			heading: 'Se solicitó un enlace de inicio de sesión para tu cuenta.',
			subheading: 'Haz clic en el botón de abajo para iniciar sesión:',
			cta: 'Iniciar sesión',
			expires: 'Este enlace expira en {{expiresInMinutes}} minutos.',
			ignore: 'Si no solicitaste esto, ignora este correo.',
		},
		emailOtp: {
			subject: '[{{appName}}] Tu código de verificación',
			heading: 'Aquí está tu código de verificación de inicio de sesión.',
			instruction: 'Ingresa el siguiente código para completar tu inicio de sesión:',
			expires: 'Este código expira en {{expiresInMinutes}} minutos.',
			ignore: 'Si no solicitaste esto, ignora este correo.',
		},
		emailChange: {
			subject: '[{{appName}}] Confirmar cambio de correo',
			heading: 'Se solicitó un cambio de dirección de correo electrónico para tu cuenta.',
			instruction: 'Para cambiar tu correo a <strong>{{newEmail}}</strong>, haz clic en el botón de abajo:',
			cta: 'Confirmar cambio de correo',
			tokenLabel: 'O ingresa el código de verificación manualmente:',
			expires: 'Este enlace expira en {{expiresInHours}} horas.',
			ignore: 'Si no solicitaste esto, ignora este correo. Tu dirección de correo no será modificada.',
		},
	},
	fr: {
		verification: {
			subject: "[{{appName}}] Vérifiez votre adresse e-mail",
			heading: 'Veuillez vérifier votre adresse e-mail.',
			subheading: 'Cliquez sur le bouton ci-dessous ou entrez le code de vérification :',
			cta: "Vérifier l'e-mail",
			tokenLabel: 'Ou entrez le code de vérification manuellement :',
			expires: 'Ce lien expire dans {{expiresInHours}} heures.',
			ignore: "Si vous n'avez pas fait cette demande, veuillez ignorer cet e-mail.",
		},
		passwordReset: {
			subject: '[{{appName}}] Réinitialisation du mot de passe',
			heading: 'Vous avez demandé une réinitialisation de mot de passe.',
			subheading: 'Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe :',
			cta: 'Réinitialiser le mot de passe',
			tokenLabel: 'Ou entrez le code de réinitialisation manuellement :',
			expires: 'Ce lien expire dans {{expiresInMinutes}} minutes.',
			ignore: "Si vous n'avez pas fait cette demande, veuillez ignorer cet e-mail. Votre mot de passe ne sera pas modifié.",
		},
		magicLink: {
			subject: '[{{appName}}] Votre lien de connexion',
			heading: 'Un lien de connexion a été demandé pour votre compte.',
			subheading: 'Cliquez sur le bouton ci-dessous pour vous connecter :',
			cta: 'Se connecter',
			expires: 'Ce lien expire dans {{expiresInMinutes}} minutes.',
			ignore: "Si vous n'avez pas fait cette demande, veuillez ignorer cet e-mail.",
		},
		emailOtp: {
			subject: '[{{appName}}] Votre code de connexion',
			heading: 'Voici votre code de vérification de connexion.',
			instruction: 'Entrez le code ci-dessous pour terminer votre connexion :',
			expires: 'Ce code expire dans {{expiresInMinutes}} minutes.',
			ignore: "Si vous n'avez pas fait cette demande, veuillez ignorer cet e-mail.",
		},
		emailChange: {
			subject: "[{{appName}}] Confirmer le changement d'e-mail",
			heading: "Un changement d'adresse e-mail a été demandé pour votre compte.",
			instruction: 'Pour changer votre e-mail en <strong>{{newEmail}}</strong>, cliquez sur le bouton ci-dessous :',
			cta: 'Confirmer le changement',
			tokenLabel: 'Ou entrez le code de vérification manuellement :',
			expires: 'Ce lien expire dans {{expiresInHours}} heures.',
			ignore: "Si vous n'avez pas fait cette demande, veuillez ignorer cet e-mail. Votre adresse e-mail ne sera pas modifiée.",
		},
	},
	de: {
		verification: {
			subject: '[{{appName}}] E-Mail bestätigen',
			heading: 'Bitte bestätigen Sie Ihre E-Mail-Adresse.',
			subheading: 'Klicken Sie auf die Schaltfläche unten oder geben Sie den Bestätigungscode ein:',
			cta: 'E-Mail bestätigen',
			tokenLabel: 'Oder geben Sie den Bestätigungscode manuell ein:',
			expires: 'Dieser Link läuft in {{expiresInHours}} Stunden ab.',
			ignore: 'Wenn Sie dies nicht angefordert haben, ignorieren Sie bitte diese E-Mail.',
		},
		passwordReset: {
			subject: '[{{appName}}] Passwort zurücksetzen',
			heading: 'Sie haben ein Zurücksetzen des Passworts angefordert.',
			subheading: 'Klicken Sie auf die Schaltfläche unten, um ein neues Passwort festzulegen:',
			cta: 'Passwort zurücksetzen',
			tokenLabel: 'Oder geben Sie den Zurücksetzungscode manuell ein:',
			expires: 'Dieser Link läuft in {{expiresInMinutes}} Minuten ab.',
			ignore: 'Wenn Sie dies nicht angefordert haben, ignorieren Sie bitte diese E-Mail. Ihr Passwort wird nicht geändert.',
		},
		magicLink: {
			subject: '[{{appName}}] Ihr Anmeldelink',
			heading: 'Ein Anmeldelink wurde für Ihr Konto angefordert.',
			subheading: 'Klicken Sie auf die Schaltfläche unten, um sich anzumelden:',
			cta: 'Anmelden',
			expires: 'Dieser Link läuft in {{expiresInMinutes}} Minuten ab.',
			ignore: 'Wenn Sie dies nicht angefordert haben, ignorieren Sie bitte diese E-Mail.',
		},
		emailOtp: {
			subject: '[{{appName}}] Ihr Anmeldecode',
			heading: 'Hier ist Ihr Anmelde-Bestätigungscode.',
			instruction: 'Geben Sie den folgenden Code ein, um Ihre Anmeldung abzuschließen:',
			expires: 'Dieser Code läuft in {{expiresInMinutes}} Minuten ab.',
			ignore: 'Wenn Sie dies nicht angefordert haben, ignorieren Sie bitte diese E-Mail.',
		},
		emailChange: {
			subject: '[{{appName}}] E-Mail-Änderung bestätigen',
			heading: 'Eine Änderung der E-Mail-Adresse wurde für Ihr Konto angefordert.',
			instruction: 'Um Ihre E-Mail zu <strong>{{newEmail}}</strong> zu ändern, klicken Sie auf die Schaltfläche unten:',
			cta: 'E-Mail-Änderung bestätigen',
			tokenLabel: 'Oder geben Sie den Bestätigungscode manuell ein:',
			expires: 'Dieser Link läuft in {{expiresInHours}} Stunden ab.',
			ignore: 'Wenn Sie dies nicht angefordert haben, ignorieren Sie bitte diese E-Mail. Ihre E-Mail-Adresse wird nicht geändert.',
		},
	},
	pt: {
		verification: {
			subject: '[{{appName}}] Verifique seu e-mail',
			heading: 'Por favor, verifique seu endereço de e-mail.',
			subheading: 'Clique no botão abaixo ou insira o código de verificação:',
			cta: 'Verificar e-mail',
			tokenLabel: 'Ou insira o código de verificação manualmente:',
			expires: 'Este link expira em {{expiresInHours}} horas.',
			ignore: 'Se você não solicitou isso, ignore este e-mail.',
		},
		passwordReset: {
			subject: '[{{appName}}] Redefinir senha',
			heading: 'Você solicitou uma redefinição de senha.',
			subheading: 'Clique no botão abaixo para definir uma nova senha:',
			cta: 'Redefinir senha',
			tokenLabel: 'Ou insira o código de redefinição manualmente:',
			expires: 'Este link expira em {{expiresInMinutes}} minutos.',
			ignore: 'Se você não solicitou isso, ignore este e-mail. Sua senha não será alterada.',
		},
		magicLink: {
			subject: '[{{appName}}] Seu link de login',
			heading: 'Um link de login foi solicitado para sua conta.',
			subheading: 'Clique no botão abaixo para fazer login:',
			cta: 'Fazer login',
			expires: 'Este link expira em {{expiresInMinutes}} minutos.',
			ignore: 'Se você não solicitou isso, ignore este e-mail.',
		},
		emailOtp: {
			subject: '[{{appName}}] Seu código de login',
			heading: 'Aqui está seu código de verificação de login.',
			instruction: 'Insira o código abaixo para concluir seu login:',
			expires: 'Este código expira em {{expiresInMinutes}} minutos.',
			ignore: 'Se você não solicitou isso, ignore este e-mail.',
		},
		emailChange: {
			subject: '[{{appName}}] Confirmar alteração de e-mail',
			heading: 'Uma alteração de endereço de e-mail foi solicitada para sua conta.',
			instruction: 'Para alterar seu e-mail para <strong>{{newEmail}}</strong>, clique no botão abaixo:',
			cta: 'Confirmar alteração',
			tokenLabel: 'Ou insira o código de verificação manualmente:',
			expires: 'Este link expira em {{expiresInHours}} horas.',
			ignore: 'Se você não solicitou isso, ignore este e-mail. Seu endereço de e-mail não será alterado.',
		},
	},
};

function getStrings(locale: string, type: EmailType): EmailStrings {
	const base = locale.split('-')[0];
	return translations[locale]?.[type] ?? translations[base]?.[type] ?? translations.en[type];
}

// ─── English defaults (backward compat) ───

export const DEFAULT_SUBJECTS: Record<EmailType, string> = {
	verification: '[{{appName}}] Verify your email',
	passwordReset: '[{{appName}}] Reset your password',
	magicLink: '[{{appName}}] Your login link',
	emailOtp: '[{{appName}}] Your login code',
	emailChange: '[{{appName}}] Confirm email change',
};

export const VARIABLE_REFERENCE: Record<EmailType, { name: string; description: string }[]> = {
	verification: [
		{ name: '{{appName}}', description: 'Application name' },
		{ name: '{{verifyUrl}}', description: 'Full verification URL' },
		{ name: '{{token}}', description: 'Verification token' },
		{ name: '{{expiresInHours}}', description: 'Expiration time in hours' },
	],
	passwordReset: [
		{ name: '{{appName}}', description: 'Application name' },
		{ name: '{{resetUrl}}', description: 'Full password reset URL' },
		{ name: '{{token}}', description: 'Reset token' },
		{ name: '{{expiresInMinutes}}', description: 'Expiration time in minutes' },
	],
	magicLink: [
		{ name: '{{appName}}', description: 'Application name' },
		{ name: '{{magicLinkUrl}}', description: 'Full magic link URL' },
		{ name: '{{expiresInMinutes}}', description: 'Expiration time in minutes' },
	],
	emailOtp: [
		{ name: '{{appName}}', description: 'Application name' },
		{ name: '{{code}}', description: 'OTP verification code' },
		{ name: '{{expiresInMinutes}}', description: 'Expiration time in minutes' },
	],
	emailChange: [
		{ name: '{{appName}}', description: 'Application name' },
		{ name: '{{verifyUrl}}', description: 'Full verification URL' },
		{ name: '{{token}}', description: 'Verification token' },
		{ name: '{{newEmail}}', description: 'New email address' },
		{ name: '{{expiresInHours}}', description: 'Expiration time in hours' },
	],
};

export const SAMPLE_VARIABLES: Record<EmailType, Record<string, string | number>> = {
	verification: {
		appName: 'MyApp',
		verifyUrl: 'https://example.com/auth/verify?token=abc123def456',
		token: 'abc123def456',
		expiresInHours: 24,
	},
	passwordReset: {
		appName: 'MyApp',
		resetUrl: 'https://example.com/auth/reset?token=xyz789',
		token: 'xyz789',
		expiresInMinutes: 30,
	},
	magicLink: {
		appName: 'MyApp',
		magicLinkUrl: 'https://example.com/auth/magic?token=ml456abc',
		expiresInMinutes: 15,
	},
	emailOtp: {
		appName: 'MyApp',
		code: '847293',
		expiresInMinutes: 10,
	},
	emailChange: {
		appName: 'MyApp',
		verifyUrl: 'https://example.com/auth/verify-email-change?token=ec789',
		token: 'ec789',
		newEmail: 'newemail@example.com',
		expiresInHours: 24,
	},
};

// ─── Shared styles (matches server email-templates.ts SHARED_STYLES) ───

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

function esc(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// ─── Per-Locale Default Template Generator ───

/** Generate the built-in default subject for a given email type and locale. */
export function getDefaultSubjectForLocale(type: EmailType, locale: string): string {
	return getStrings(locale, type).subject;
}

/** Generate the built-in default HTML template for a given email type and locale. */
export function getDefaultTemplateForLocale(type: EmailType, locale: string): string {
	const s = getStrings(locale, type);

	// Template structures vary by type
	if (type === 'verification') {
		return `<!DOCTYPE html>
<html lang="${esc(locale)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${SHARED_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header"><h1>{{appName}}</h1></div>
    <div class="body">
      <p>${esc(s.heading)}</p>
      <p>${esc(s.subheading ?? '')}</p>
      <p style="text-align:center"><a class="btn" href="{{verifyUrl}}">${esc(s.cta ?? 'Verify Email')}</a></p>
      <p>${esc(s.tokenLabel ?? '')}</p>
      <div class="code">{{token}}</div>
      <p class="muted">${esc(s.expires)}</p>
      <p class="muted">${esc(s.ignore)}</p>
    </div>
    <div class="footer">&copy; {{appName}}</div>
  </div>
</body>
</html>`;
	}

	if (type === 'passwordReset') {
		return `<!DOCTYPE html>
<html lang="${esc(locale)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${SHARED_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header"><h1>{{appName}}</h1></div>
    <div class="body">
      <p>${esc(s.heading)}</p>
      <p>${esc(s.subheading ?? '')}</p>
      <p style="text-align:center"><a class="btn" href="{{resetUrl}}">${esc(s.cta ?? 'Reset Password')}</a></p>
      <p>${esc(s.tokenLabel ?? '')}</p>
      <div class="code">{{token}}</div>
      <p class="muted">${esc(s.expires)}</p>
      <p class="muted">${esc(s.ignore)}</p>
    </div>
    <div class="footer">&copy; {{appName}}</div>
  </div>
</body>
</html>`;
	}

	if (type === 'magicLink') {
		return `<!DOCTYPE html>
<html lang="${esc(locale)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${SHARED_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header"><h1>{{appName}}</h1></div>
    <div class="body">
      <p>${esc(s.heading)}</p>
      <p>${esc(s.subheading ?? '')}</p>
      <p style="text-align:center"><a class="btn" href="{{magicLinkUrl}}">${esc(s.cta ?? 'Sign In')}</a></p>
      <p class="muted">${esc(s.expires)}</p>
      <p class="muted">${esc(s.ignore)}</p>
    </div>
    <div class="footer">&copy; {{appName}}</div>
  </div>
</body>
</html>`;
	}

	if (type === 'emailOtp') {
		return `<!DOCTYPE html>
<html lang="${esc(locale)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${SHARED_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header"><h1>{{appName}}</h1></div>
    <div class="body">
      <p>${esc(s.heading)}</p>
      <p>${esc(s.instruction ?? '')}</p>
      <div class="code">{{code}}</div>
      <p class="muted">${esc(s.expires)}</p>
      <p class="muted">${esc(s.ignore)}</p>
    </div>
    <div class="footer">&copy; {{appName}}</div>
  </div>
</body>
</html>`;
	}

	// emailChange — instruction contains <strong>{{newEmail}}</strong> (raw HTML)
	const instructionHtml = s.instruction ?? 'To change your email to <strong>{{newEmail}}</strong>, click the button below:';
	return `<!DOCTYPE html>
<html lang="${esc(locale)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${SHARED_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header"><h1>{{appName}}</h1></div>
    <div class="body">
      <p>${esc(s.heading)}</p>
      <p>${instructionHtml}</p>
      <p style="text-align:center"><a class="btn" href="{{verifyUrl}}">${esc(s.cta ?? 'Confirm Email Change')}</a></p>
      <p>${esc(s.tokenLabel ?? '')}</p>
      <div class="code">{{token}}</div>
      <p class="muted">${esc(s.expires)}</p>
      <p class="muted">${esc(s.ignore)}</p>
    </div>
    <div class="footer">&copy; {{appName}}</div>
  </div>
</body>
</html>`;
}

// ─── English Defaults (backward compat) ───

export const DEFAULT_TEMPLATES: Record<EmailType, string> = {
	verification: getDefaultTemplateForLocale('verification', 'en'),
	passwordReset: getDefaultTemplateForLocale('passwordReset', 'en'),
	magicLink: getDefaultTemplateForLocale('magicLink', 'en'),
	emailOtp: getDefaultTemplateForLocale('emailOtp', 'en'),
	emailChange: getDefaultTemplateForLocale('emailChange', 'en'),
};

// ─── LocalizedString Helpers ───

/** A config value that can be a simple string or a per-locale map. */
export type LocalizedString = string | Record<string, string>;

/**
 * Resolve a LocalizedString value for a specific locale.
 * Fallback: exact locale → base language → 'en' → undefined
 */
export function resolveLocalizedValue(value: LocalizedString | null | undefined, locale: string): string | undefined {
	if (!value) return undefined;
	if (typeof value === 'string') return value; // global override — same for all locales
	const base = locale.split('-')[0];
	return value[locale] ?? value[base] ?? value['en'] ?? undefined;
}

/**
 * Replace {{variable}} placeholders with sample values for preview rendering.
 */
export function renderPreview(template: string, type: EmailType): string {
	const vars = SAMPLE_VARIABLES[type];
	return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
		const val = vars[key as string];
		return val !== undefined ? esc(String(val)) : match;
	});
}
