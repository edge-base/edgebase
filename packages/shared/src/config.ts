// ─── Schema Field Types ───

export type FieldType = 'string' | 'text' | 'number' | 'boolean' | 'datetime' | 'json';

export interface SchemaField {
  type: FieldType;
  required?: boolean;
  default?: unknown;
  unique?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  enum?: string[];
  primaryKey?: boolean;
  onUpdate?: 'now';
  /**
   * SQLite REFERENCES (FK) for this column. (#133 §35)
   * Object form: { table: 'users', onDelete: 'CASCADE' }
   * String short form: 'users' or 'users(id)'
   * Note: PRAGMA foreign_keys = ON is set at DB init in database-do.ts.
   * Auth-user references (`users`, `_users`, `_users_public`) are logical-only
   * because auth data lives in AUTH_DB, so no physical FK is emitted for them.
   */
  references?: string | FkReference;
  /** SQLite CHECK expression. e.g. check: 'score >= 0 AND score <= 100' (#133 §35) */
  check?: string;
}

export interface IndexConfig {
  fields: string[];
  unique?: boolean;
}

// ─── Foreign Key Reference (§35) ───

/**
 * Foreign key reference config for SchemaField.references. (#133 §35)
 * database-do.ts sets PRAGMA foreign_keys = ON at DO init.
 * Cross-DB-block FKs are DDL-excluded (different SQLite files).
 * Auth-user references are also DDL-excluded because they live in AUTH_DB.
 */
export interface FkReference {
  table: string;
  column?: string;
  onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

export interface MigrationConfig {
  version: number;
  description: string;
  /** SQLite migration SQL. Used for provider='do' or when upPg is not provided. */
  up: string;
  /** PostgreSQL-specific migration SQL. When present, used instead of `up` for provider='neon'|'postgres'. */
  upPg?: string;
}

// ─── Auth Context ───

export interface AuthContext {
  id: string;
  role?: string;
  isAnonymous?: boolean;
  email?: string;
  custom?: Record<string, unknown>;
  memberships?: Array<{ id: string; role?: string }>;
  /**
   * Open-ended extension map injected by `auth.handlers.hooks.enrich` (#133 §38).
   * Allows passing arbitrary request-scoped data into rules without JWT re-issuance.
   * e.g. { workspaceRole: 'admin', orgIds: ['o1', 'o2'] }
   */
  meta?: Record<string, unknown>;
}

// ─── Hook Context (passed to table hooks) ───

export interface HookCtx {
  db: {
    get(table: string, id: string): Promise<Record<string, unknown> | null>;
    list(table: string, filter?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
    exists(table: string, filter: Record<string, unknown>): Promise<boolean>;
  };
  databaseLive: {
    broadcast(channel: string, event: string, data: unknown): Promise<void>;
  };
  push: {
    send(userId: string, payload: { title?: string; body: string }): Promise<void>;
  };
  waitUntil(promise: Promise<unknown>): void;
}

// ─── DB Rule Context (passed to DB-level access rule) ───

export interface DbRuleCtx {
  db: {
    get(table: string, id: string): Promise<Record<string, unknown> | null>;
    exists(table: string, filter: Record<string, unknown>): Promise<boolean>;
  };
}

// ─── Table-level Rules (§3) ───
// Rules return only true | false — pure access gate, no data transformation.

export interface TableRules {
  /** Who can read (list/get/search) rows. Boolean or (auth, row) => boolean. */
  read?:
    | boolean
    | ((auth: AuthContext | null, row: Record<string, unknown>) => boolean | Promise<boolean>);
  /** Who can insert rows. Boolean or (auth) => boolean. */
  insert?: boolean | ((auth: AuthContext | null) => boolean | Promise<boolean>);
  /** Who can update rows. Boolean or (auth, row) => boolean. */
  update?:
    | boolean
    | ((auth: AuthContext | null, row: Record<string, unknown>) => boolean | Promise<boolean>);
  /** Who can delete rows. Boolean or (auth, row) => boolean. */
  delete?:
    | boolean
    | ((auth: AuthContext | null, row: Record<string, unknown>) => boolean | Promise<boolean>);
}

// ─── Table-level Hooks (§6) ───
// before*: blocking — return object to transform data, throw to reject.
// after*: non-blocking (waitUntil) — side effects, return value ignored.

export interface TableHooks {
  /** Runs before insert. Return transformed data or throw to reject. */
  beforeInsert?: (
    auth: AuthContext | null,
    data: Record<string, unknown>,
    ctx: HookCtx,
  ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  /** Runs after insert (fire-and-forget via waitUntil). */
  afterInsert?: (data: Record<string, unknown>, ctx: HookCtx) => Promise<void> | void;
  /** Runs before update. Return transformed data or throw to reject. */
  beforeUpdate?: (
    auth: AuthContext | null,
    before: Record<string, unknown>,
    data: Record<string, unknown>,
    ctx: HookCtx,
  ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  /** Runs after update (fire-and-forget via waitUntil). */
  afterUpdate?: (
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    ctx: HookCtx,
  ) => Promise<void> | void;
  /** Runs before delete. Throw to reject. */
  beforeDelete?: (
    auth: AuthContext | null,
    data: Record<string, unknown>,
    ctx: HookCtx,
  ) => Promise<void> | void;
  /** Runs after delete (fire-and-forget via waitUntil). */
  afterDelete?: (data: Record<string, unknown>, ctx: HookCtx) => Promise<void> | void;
  /**
   * Runs after read (GET/LIST/SEARCH), before response. Applied per-row. Blocking.
   * Return modified record to add computed fields or strip fields. Return void for no change.
   */
  onEnrich?: (
    auth: AuthContext | null,
    record: Record<string, unknown>,
    ctx: HookCtx,
  ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
}

export type TableAccess = TableRules;

export interface TableHandlers {
  hooks?: TableHooks;
}

// ─── Table Config ───

export interface TableConfig {
  /** Schema definition. Optional — omit for schemaless CRUD (no type validation/indexes/FTS). */
  schema?: Record<string, SchemaField | false>;
  access?: TableAccess;
  handlers?: TableHandlers;
  indexes?: IndexConfig[];
  fts?: string[];
  migrations?: MigrationConfig[];
}

// ─── DB-level Rules (§4) ───
// canCreate: deny-by-default when omitted (§12 ③).
// access: async supported — may do DB lookup for membership.

export interface DbLevelRules {
  /**
   * Allow creating a new DO instance (new namespace:id).
   * Default: false — deny-by-default. Must explicitly set to allow creation.
   */
  canCreate?: (auth: AuthContext | null, id: string) => boolean | Promise<boolean>;
  /**
   * Allow accessing an existing DO instance.
   * async supported — can perform DB lookups for membership checks.
   */
  access?: (auth: AuthContext | null, id: string, ctx: DbRuleCtx) => boolean | Promise<boolean>;
  /** Allow deleting a DO instance. */
  delete?: (auth: AuthContext | null, id: string) => boolean;
}

export type DbAccess = DbLevelRules;

export interface AdminInstanceDiscoveryOption {
  id: string;
  label?: string;
  description?: string;
}

export interface AdminInstanceDiscoveryContext {
  namespace: string;
  query: string;
  limit: number;
  admin: {
    sql(namespace: string, sql: string, options?: { id?: string; params?: unknown[] }): Promise<Record<string, unknown>[]>;
  };
}

export interface ManualAdminInstanceDiscovery {
  source: 'manual';
  targetLabel?: string;
  placeholder?: string;
  helperText?: string;
}

export interface TableAdminInstanceDiscovery {
  source: 'table';
  targetLabel?: string;
  namespace: string;
  table: string;
  idField?: string;
  labelField?: string;
  descriptionField?: string;
  searchFields?: string[];
  orderBy?: string;
  limit?: number;
  placeholder?: string;
  helperText?: string;
}

export interface FunctionAdminInstanceDiscovery {
  source: 'function';
  targetLabel?: string;
  resolve: (
    ctx: AdminInstanceDiscoveryContext,
  ) => Promise<AdminInstanceDiscoveryOption[]> | AdminInstanceDiscoveryOption[];
  placeholder?: string;
  helperText?: string;
}

export type AdminInstanceDiscovery =
  | ManualAdminInstanceDiscovery
  | TableAdminInstanceDiscovery
  | FunctionAdminInstanceDiscovery;

export interface DbAdminConfig {
  /**
   * Admin dashboard instance discovery for dynamic namespaces.
   * Lets the dashboard suggest instance IDs instead of relying on manual entry.
   */
  instances?: AdminInstanceDiscovery;
}

// ─── DB Block (§1) ───
// Static DB (no id): key = 'shared'
// Dynamic DB (with id): key = 'workspace' | 'user' | any namespace name
// Clients explicitly send namespace + id: edgebase.db('workspace', 'ws-456')

/** Database backend provider type. */
export type DbProvider = 'do' | 'd1' | 'neon' | 'postgres';

/** Auth database backend provider type. */
export type AuthDbProvider = 'd1' | 'neon' | 'postgres';

export interface DbBlock {
  /**
   * Database backend provider.
   * - `'do'`: Durable Object + SQLite. Edge-native, physical isolation per instance.
   * - `'d1'`: Cloudflare D1. Exportable via `wrangler d1 export`, enables migration to PostgreSQL.
   * - `'neon'`: Neon PostgreSQL. Use `npx edgebase neon setup` or provide a connectionString env key; deploy provisions Hyperdrive from it.
   * - `'postgres'`: Custom PostgreSQL. User provides connectionString manually.
   *
   * Default: Single-instance namespaces (no `instance` flag) default to D1.
   *          Multi-tenant namespaces (`instance: true`) default to DO.
   *
   * SDK code is identical regardless of provider — the server routes internally.
   */
  provider?: DbProvider;
  /**
   * Multi-tenant instance mode.
   * When true, each instanceId gets its own Durable Object (physical isolation).
   * When false/omitted, the namespace is a single-instance database routed to D1.
   *
   * Example:
   *   `instance: true` → `edgebase.db('workspace', 'ws-456')` creates DO per workspace
   *   (no instance)    → `edgebase.db('shared')` routes to a single D1 database
   */
  instance?: boolean;
  /**
   * PostgreSQL connection string (or env variable reference).
   * Only used when provider is `'neon'` or `'postgres'`.
   * For deploy: reads from `.env.release` using key `DB_POSTGRES_{NAMESPACE_UPPER}_URL`
   *             (or a custom env key if connectionString is set).
   * For dev: reads from `.env.development` using the same key.
  */
  connectionString?: string;
  access?: DbAccess;
  admin?: DbAdminConfig;
  /** Tables within this DB namespace. */
  tables?: Record<string, TableConfig>;
}

// ─── Storage Config (§5) ───
// maxFileSize / allowedMimeTypes removed — use write rule function instead.

export interface WriteFileMeta {
  /** File size in bytes from form data */
  size: number;
  /** MIME type from form data */
  contentType: string;
  /** Requested file path/key */
  key: string;
}

export interface R2FileMeta {
  size: number;
  contentType: string;
  key: string;
  etag?: string;
  uploadedAt?: string;
  uploadedBy?: string;
  customMetadata?: Record<string, string>;
}

export interface StorageBucketRules {
  read?: (auth: AuthContext | null, file: R2FileMeta) => boolean;
  /** write: file = form data meta (§19) — size/contentType available before upload */
  write?: (auth: AuthContext | null, file: WriteFileMeta) => boolean;
  delete?: (auth: AuthContext | null, file: R2FileMeta) => boolean;
}

// ─── Storage Hook Context ───
// Storage runs in Worker (not DO), so no db access. Only waitUntil + push.

export interface StorageHookCtx {
  waitUntil(promise: Promise<unknown>): void;
  push: {
    send(userId: string, payload: { title?: string; body: string }): Promise<void>;
  };
}

// ─── Storage Hooks ───
// All hooks receive metadata only — NO file binary (128MB Worker memory limit).

export interface StorageHooks {
  /** Before upload. Return custom metadata to merge, or throw to reject. NO file body. */
  beforeUpload?: (
    auth: AuthContext | null,
    file: WriteFileMeta,
    ctx: StorageHookCtx,
  ) => Promise<Record<string, string> | void> | Record<string, string> | void;
  /** After upload (fire-and-forget via waitUntil). Receives final R2 metadata. */
  afterUpload?: (
    auth: AuthContext | null,
    file: R2FileMeta,
    ctx: StorageHookCtx,
  ) => Promise<void> | void;
  /** Before delete. Throw to reject. */
  beforeDelete?: (
    auth: AuthContext | null,
    file: R2FileMeta,
    ctx: StorageHookCtx,
  ) => Promise<void> | void;
  /** After delete (fire-and-forget via waitUntil). */
  afterDelete?: (
    auth: AuthContext | null,
    file: R2FileMeta,
    ctx: StorageHookCtx,
  ) => Promise<void> | void;
  /** Before download. Throw to reject. */
  beforeDownload?: (
    auth: AuthContext | null,
    file: R2FileMeta,
    ctx: StorageHookCtx,
  ) => Promise<void> | void;
}

export type StorageBucketAccess = StorageBucketRules;

export interface StorageHandlers {
  hooks?: StorageHooks;
}

export interface StorageBucketConfig {
  access?: StorageBucketAccess;
  handlers?: StorageHandlers;
  binding?: string;
}

export interface StorageConfig {
  buckets?: Record<string, StorageBucketConfig>;
}

// ─── Auth Config ───

export interface MagicLinkConfig {
  /** Enable magic link (passwordless email) authentication. Default: false */
  enabled?: boolean;
  /** Auto-create account if email is not registered. Default: true */
  autoCreate?: boolean;
  /** Token time-to-live. Default: '15m' */
  tokenTTL?: string;
}

export interface MfaConfig {
  /** Enable TOTP-based multi-factor authentication. Default: false */
  totp?: boolean;
}

export interface EmailOtpConfig {
  /** Enable email OTP (passwordless email code) authentication. Default: false */
  enabled?: boolean;
  /** Auto-create new user on first OTP request if email is not registered. Default: true */
  autoCreate?: boolean;
}

export interface PasswordPolicyConfig {
  /** Minimum password length. Default: 8 */
  minLength?: number;
  /** Require at least one uppercase letter. Default: false */
  requireUppercase?: boolean;
  /** Require at least one lowercase letter. Default: false */
  requireLowercase?: boolean;
  /** Require at least one digit. Default: false */
  requireNumber?: boolean;
  /** Require at least one special character. Default: false */
  requireSpecial?: boolean;
  /** Check password against HIBP (Have I Been Pwned) database via k-anonymity. Fail-open if API unavailable. Default: false */
  checkLeaked?: boolean;
}

export interface OAuthProviderCredentialsConfig {
  clientId: string;
  clientSecret: string;
}

export interface OidcProviderCredentialsConfig extends OAuthProviderCredentialsConfig {
  issuer: string;
  scopes?: string[];
}

export interface OAuthProvidersConfig {
  /** OIDC federation providers keyed by provider slug. */
  oidc?: Record<string, OidcProviderCredentialsConfig>;
  /** Built-in provider name → credentials. */
  [provider: string]:
    | OAuthProviderCredentialsConfig
    | Record<string, OidcProviderCredentialsConfig>
    | undefined;
}

export interface AuthConfig {
  /**
   * Auth database backend provider.
   * - `'d1'` (default): Cloudflare D1 (AUTH_DB binding). Zero-cost, global.
   * - `'neon'`: Neon PostgreSQL via Hyperdrive. Zero-downtime upgrade from D1.
   * - `'postgres'`: Custom PostgreSQL. User provides connectionString.
   *
   * SDK code is identical regardless of provider — the server routes internally.
   * Migration: `npx edgebase migrate auth --from=d1 --to=neon`
   */
  provider?: AuthDbProvider;
  /**
   * PostgreSQL connection string environment variable name.
   * Required when `provider` is `'neon'` or `'postgres'`.
   * `npx edgebase neon setup --auth` writes the corresponding value to local env files.
   * CLI stores the actual URL in secrets; this is the env variable key.
   * Example: `'AUTH_POSTGRES_URL'`
   */
  connectionString?: string;
  emailAuth?: boolean;
  anonymousAuth?: boolean;
  /** Enable phone/SMS OTP authentication. Default: false */
  phoneAuth?: boolean;
  allowedOAuthProviders?: string[];
  /**
   * OAuth provider credentials.
   * - Built-in: auth.oauth.{provider}.clientId / clientSecret
   * - OIDC: auth.oauth.oidc.{name}.clientId / clientSecret / issuer
   */
  oauth?: OAuthProvidersConfig;
  /**
   * Optional client redirect URL allowlist for OAuth and email-based auth actions.
   * When unset, redirect URLs are accepted as-is for backward compatibility.
   *
   * Supported forms:
   * - exact URL: 'https://app.example.com/auth/callback'
   * - origin-wide: 'https://app.example.com'
   * - prefix wildcard: 'https://app.example.com/auth/*'
   */
  allowedRedirectUrls?: string[];
  session?: {
    accessTokenTTL?: string;
    refreshTokenTTL?: string;
    /** Maximum number of active sessions per user. 0 or undefined = unlimited. Oldest sessions are evicted when limit is exceeded. */
    maxActiveSessions?: number;
  };
  anonymousRetentionDays?: number;
  /** If true, deletes user DB (user:{id}) when a user is deleted. */
  cleanupOrphanData?: boolean;
  /** Magic link (passwordless email login) configuration. */
  magicLink?: MagicLinkConfig;
  /** MFA/TOTP configuration. */
  mfa?: MfaConfig;
  /** Email OTP (passwordless email code) configuration. */
  emailOtp?: EmailOtpConfig;
  /** Password strength policy configuration. */
  passwordPolicy?: PasswordPolicyConfig;
  /** Passkeys / WebAuthn configuration. */
  passkeys?: PasskeysConfig;
  /** Preferred auth action access config. */
  access?: AuthAccess;
  /** Preferred auth handler groups. */
  handlers?: AuthHandlers;
}

export interface PasskeysConfig {
  /** Enable WebAuthn/Passkeys. Default: false */
  enabled?: boolean;
  /** Relying Party name (displayed in authenticator UI). */
  rpName: string;
  /** Relying Party ID (usually your domain, e.g. 'example.com'). */
  rpID: string;
  /** Expected origin(s) for WebAuthn requests (e.g. 'https://example.com'). */
  origin: string | string[];
}

// ─── Email Config ───

/**
 * A string value that can be either a single string (applies to all locales)
 * or a per-locale map (e.g. { en: '...', ko: '...', ja: '...' }).
 * When a per-locale map is used, locale resolution falls back: exact → base language → 'en'.
 */
export type LocalizedString = string | Record<string, string>;

/**
 * Custom HTML template overrides for auth emails.
 * Use {{variable}} placeholders for dynamic values.
 * When provided, replaces the default built-in template entirely.
 * Can be a single string (all locales) or a per-locale map for i18n.
 */
export interface EmailTemplateOverrides {
  /** Custom HTML for email verification. Variables: {{appName}}, {{verifyUrl}}, {{token}}, {{expiresInHours}} */
  verification?: LocalizedString;
  /** Custom HTML for password reset. Variables: {{appName}}, {{resetUrl}}, {{token}}, {{expiresInMinutes}} */
  passwordReset?: LocalizedString;
  /** Custom HTML for magic link login. Variables: {{appName}}, {{magicLinkUrl}}, {{expiresInMinutes}} */
  magicLink?: LocalizedString;
  /** Custom HTML for email OTP. Variables: {{appName}}, {{code}}, {{expiresInMinutes}} */
  emailOtp?: LocalizedString;
  /** Custom HTML for email change verification. Variables: {{appName}}, {{verifyUrl}}, {{token}}, {{newEmail}}, {{expiresInHours}} */
  emailChange?: LocalizedString;
}

/**
 * Custom email subject overrides. Use {{appName}} placeholder for the app name.
 * Defaults: "[{{appName}}] Verify your email", "[{{appName}}] Reset your password", etc.
 * Can be a single string (all locales) or a per-locale map for i18n.
 */
export interface EmailSubjectOverrides {
  verification?: LocalizedString;
  passwordReset?: LocalizedString;
  magicLink?: LocalizedString;
  emailOtp?: LocalizedString;
  emailChange?: LocalizedString;
}

export interface EmailConfig {
  provider: 'resend' | 'sendgrid' | 'mailgun' | 'ses';
  apiKey: string;
  from: string;
  domain?: string;
  region?: string;
  appName?: string;
  /** Default locale for auth emails when user has no preference. Default: 'en' */
  defaultLocale?: string;
  verifyUrl?: string;
  resetUrl?: string;
  /** Magic link URL template. Use {token} placeholder. e.g. 'https://app.com/auth/magic-link?token={token}' */
  magicLinkUrl?: string;
  /** Email change verification URL template. Use {token} placeholder. e.g. 'https://app.com/auth/verify-email-change?token={token}' */
  emailChangeUrl?: string;
  /** Custom HTML template overrides for auth emails. */
  templates?: EmailTemplateOverrides;
  /** Custom email subject line overrides. */
  subjects?: EmailSubjectOverrides;
}

// ─── Mail Hooks ───

export type MailType = 'verification' | 'passwordReset' | 'magicLink' | 'emailOtp' | 'emailChange';

export interface MailHookCtx {
  waitUntil(promise: Promise<unknown>): void;
}

export interface MailHooks {
  /**
   * Intercept outgoing emails. Can modify subject/html or reject (throw). Blocking, 5s timeout.
   * The optional `locale` parameter contains the resolved locale used for the email.
   */
  onSend?: (
    type: MailType,
    to: string,
    subject: string,
    html: string,
    ctx: MailHookCtx,
    locale?: string,
  ) =>
    | Promise<{ subject?: string; html?: string } | void>
    | { subject?: string; html?: string }
    | void;
}

export type SmsType = 'phoneOtp' | 'phoneLink';

export interface SmsHookCtx {
  waitUntil(promise: Promise<unknown>): void;
}

export interface SmsHooks {
  /**
   * Intercept outgoing SMS. Can modify body or reject (throw). Blocking, 5s timeout.
   */
  onSend?: (
    type: SmsType,
    to: string,
    body: string,
    ctx: SmsHookCtx,
  ) => Promise<{ body?: string } | void> | { body?: string } | void;
}

export interface AuthAccessCtx {
  request?: unknown;
  auth?: AuthContext | null;
  ip?: string;
}

export type AuthAccessRule = (
  input: Record<string, unknown> | null,
  ctx: AuthAccessCtx,
) => boolean | Promise<boolean>;

export interface AuthAccess {
  signUp?: AuthAccessRule;
  signIn?: AuthAccessRule;
  signInAnonymous?: AuthAccessRule;
  signInMagicLink?: AuthAccessRule;
  verifyMagicLink?: AuthAccessRule;
  signInPhone?: AuthAccessRule;
  verifyPhoneOtp?: AuthAccessRule;
  linkPhone?: AuthAccessRule;
  verifyLinkPhone?: AuthAccessRule;
  signInEmailOtp?: AuthAccessRule;
  verifyEmailOtp?: AuthAccessRule;
  mfaTotpEnroll?: AuthAccessRule;
  mfaTotpVerify?: AuthAccessRule;
  mfaVerify?: AuthAccessRule;
  mfaRecovery?: AuthAccessRule;
  mfaTotpDelete?: AuthAccessRule;
  mfaFactors?: AuthAccessRule;
  requestPasswordReset?: AuthAccessRule;
  resetPassword?: AuthAccessRule;
  verifyEmail?: AuthAccessRule;
  changePassword?: AuthAccessRule;
  changeEmail?: AuthAccessRule;
  verifyEmailChange?: AuthAccessRule;
  passkeysRegisterOptions?: AuthAccessRule;
  passkeysRegister?: AuthAccessRule;
  passkeysAuthOptions?: AuthAccessRule;
  passkeysAuthenticate?: AuthAccessRule;
  passkeysList?: AuthAccessRule;
  passkeysDelete?: AuthAccessRule;
  getMe?: AuthAccessRule;
  updateProfile?: AuthAccessRule;
  getSessions?: AuthAccessRule;
  deleteSession?: AuthAccessRule;
  getIdentities?: AuthAccessRule;
  deleteIdentity?: AuthAccessRule;
  linkEmail?: AuthAccessRule;
  oauthRedirect?: AuthAccessRule;
  oauthCallback?: AuthAccessRule;
  oauthLinkStart?: AuthAccessRule;
  oauthLinkCallback?: AuthAccessRule;
  refresh?: AuthAccessRule;
  signOut?: AuthAccessRule;
}

export interface AuthHandlerHooks {
  enrich?: (
    auth: AuthContext,
    request: unknown,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface AuthHandlers {
  hooks?: AuthHandlerHooks;
  email?: MailHooks;
  sms?: SmsHooks;
}

// ─── SMS Config ───

export interface SmsConfig {
  provider: 'twilio' | 'messagebird' | 'vonage';
  /** Twilio Account SID */
  accountSid?: string;
  /** Twilio Auth Token */
  authToken?: string;
  /** MessageBird / Vonage API Key */
  apiKey?: string;
  /** Vonage API Secret */
  apiSecret?: string;
  /** Sender phone number in E.164 format (e.g. '+15551234567') */
  from: string;
}

// ─── CORS Config ───

export interface CorsConfig {
  origin?: string | string[];
  methods?: string[];
  credentials?: boolean;
  maxAge?: number;
}

// ─── Rate Limiting Config ───

export interface RateLimitGroupConfig {
  requests: number;
  window: string | number;
  /**
   * Optional Cloudflare Rate Limiting Binding override.
   * Applied by the CLI when synthesizing a temporary wrangler.toml for dev/deploy.
   */
  binding?: RateLimitBindingConfig;
}

export interface RateLimitBindingConfig {
  /** Disable the Cloudflare binding for this built-in group. */
  enabled?: boolean;
  /** Binding ceiling. Defaults to the framework safety-net value when omitted. */
  limit?: number;
  /** Cloudflare currently supports only 10s or 60s periods. */
  period?: 10 | 60;
  /** Optional custom namespace_id for the binding. */
  namespaceId?: string;
}

export interface RateLimitingConfig {
  [key: string]: RateLimitGroupConfig | undefined;
  global?: RateLimitGroupConfig;
  auth?: RateLimitGroupConfig;
  authSignin?: RateLimitGroupConfig;
  authSignup?: RateLimitGroupConfig;
  db?: RateLimitGroupConfig;
  storage?: RateLimitGroupConfig;
  functions?: RateLimitGroupConfig;
  events?: RateLimitGroupConfig;
}

// ─── Functions Config ───

export interface FunctionsConfig {
  scheduleFunctionTimeout?: string;
}

// ─── Cloudflare Config ───

export interface CloudflareConfig {
  /**
   * Additional raw Wrangler cron triggers to include at deploy time.
   * These wake the Worker's scheduled() handler even when not tied to a
   * specific schedule function.
   */
  extraCrons?: string[];
}

// ─── API Config ───

export interface ApiConfig {
  schemaEndpoint?: boolean | 'authenticated';
}

// ─── Service Key Config ───

export type ScopeString = string;

export interface ServiceKeyConstraints {
  expiresAt?: string;
  env?: string[];
  ipCidr?: string[];
  tenant?: string;
}

export interface ServiceKeyEntry {
  kid: string;
  tier: 'root' | 'scoped';
  scopes: ScopeString[];
  constraints?: ServiceKeyConstraints;
  secretSource: 'dashboard' | 'inline';
  secretRef?: string;
  inlineSecret?: string;
  enabled?: boolean;
}

export interface ServiceKeysConfig {
  policyVersion?: number;
  keys: ServiceKeyEntry[];
}

// ─── Captcha Config ───

export interface CaptchaConfig {
  siteKey: string;
  secretKey: string;
  failMode?: 'open' | 'closed';
  siteverifyTimeout?: number;
}

// ─── KV/D1/Vectorize Config ───

export interface KvNamespaceRules {
  read?: (auth: AuthContext | null) => boolean;
  write?: (auth: AuthContext | null) => boolean;
}

export interface KvNamespaceConfig {
  binding: string;
  rules?: KvNamespaceRules;
}

export interface D1DatabaseConfig {
  binding: string;
}

export interface VectorizeConfig {
  binding?: string;
  dimensions: number;
  metric: 'cosine' | 'euclidean' | 'dot-product';
}

// ─── Push Config ───

/**
 * Optional endpoint overrides for FCM-related APIs.
 * Defaults to Google production URLs when omitted.
 * Used for testing with a mock FCM server.
 */
export interface PushFcmEndpoints {
  /** Google OAuth2 token endpoint. Default: 'https://oauth2.googleapis.com/token' */
  oauth2TokenUrl?: string;
  /** FCM HTTP v1 send endpoint. Default: 'https://fcm.googleapis.com/v1/projects/{projectId}/messages:send' */
  fcmSendUrl?: string;
  /** IID (Instance ID) API base URL. Default: 'https://iid.googleapis.com' */
  iidBaseUrl?: string;
}

export interface PushFcmConfig {
  projectId: string;
  /** Override FCM/OAuth2/IID endpoints for testing. Omit for production. */
  endpoints?: PushFcmEndpoints;
  /**
   * FCM Service Account JSON string. Fallback for environments where
   * the PUSH_FCM_SERVICE_ACCOUNT env var is not directly accessible.
   * Prefer the env var in production; this is primarily for test setups.
   */
  serviceAccount?: string;
}

export interface PushRules {
  /** Who can send push notifications. */
  send?: (auth: AuthContext | null, target: { userId: string }) => boolean;
}

export type PushAccess = PushRules;

export interface PushHookCtx {
  request?: unknown;
  waitUntil(promise: Promise<unknown>): void;
}

export interface PushSendInput {
  kind: 'user' | 'users' | 'token' | 'topic' | 'broadcast';
  payload: Record<string, unknown>;
  userId?: string;
  userIds?: string[];
  token?: string;
  topic?: string;
  platform?: string;
}

export interface PushSendOutput {
  sent?: number;
  failed?: number;
  removed?: number;
  error?: string;
  raw?: unknown;
}

export interface PushHandlers {
  hooks?: {
    beforeSend?: (
      auth: AuthContext | null,
      input: PushSendInput,
      ctx: PushHookCtx,
    ) => Promise<PushSendInput | void> | PushSendInput | void;
    afterSend?: (
      auth: AuthContext | null,
      input: PushSendInput,
      output: PushSendOutput,
      ctx: PushHookCtx,
    ) => Promise<void> | void;
  };
}

export interface PushConfig {
  fcm?: PushFcmConfig;
  access?: PushAccess;
  handlers?: PushHandlers;
}

export interface DatabaseLiveConfig {
  authTimeoutMs?: number;
  batchThreshold?: number;
}

// ─── Room Config v2 ───

/** Info about the player who triggered the action / lifecycle event. */
export interface RoomSender {
  userId: string;
  connectionId: string;
  role?: string;
}

/** DB table proxy available inside Room handlers via ctx.admin.db(). */
export interface RoomTableProxy {
  get(id: string): Promise<Record<string, unknown> | null>;
  list(filter?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  insert(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(id: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  delete(id: string): Promise<void>;
}

/** DB namespace proxy: ctx.admin.db('shared').table('posts') */
export interface RoomDbProxy {
  table(name: string): RoomTableProxy;
}

/** Admin context injected into Room handlers (ctx parameter). */
export interface RoomHandlerContext {
  admin: {
    db(namespace: string, id?: string): RoomDbProxy;
    push: {
      send(userId: string, payload: { title?: string; body: string }): Promise<void>;
      sendMany(userIds: string[], payload: { title?: string; body: string }): Promise<void>;
    };
    broadcast(channel: string, event: string, data?: unknown): Promise<void>;
  };
}

/** Public member descriptor used by canonical room hooks. */
export interface RoomMemberInfo {
  memberId: string;
  userId: string;
  connectionId?: string;
  connectionCount?: number;
  role?: string;
}

export type RoomRuntimeTarget = 'rooms';

export interface RoomRuntimeConfig {
  /** Target runtime. */
  target?: RoomRuntimeTarget;
}

/**
 * Server-side Room API available inside handlers (room parameter).
 * All state mutations are server-only — clients can only read + subscribe + send().
 */
export interface RoomServerAPI {
  /** Current shared state (visible to all clients). */
  getSharedState(): Record<string, unknown>;
  /** Mutate shared state via updater function. Delta auto-broadcast to all clients. */
  setSharedState(updater: (state: Record<string, unknown>) => Record<string, unknown>): void;

  /** Get a specific player's state by userId. */
  player(userId: string): Record<string, unknown>;
  /** Get all players: [userId, state][] */
  players(): Array<[string, Record<string, unknown>]>;
  /** Mutate a player's state. Delta unicast to that player only. */
  setPlayerState(
    userId: string,
    updater: (state: Record<string, unknown>) => Record<string, unknown>,
  ): void;

  /** Current server-only state (never sent to clients). */
  getServerState(): Record<string, unknown>;
  /** Mutate server-only state. No broadcast. */
  setServerState(updater: (state: Record<string, unknown>) => Record<string, unknown>): void;

  /** Broadcast a one-off message to all connected clients. options.exclude: userIds to skip. */
  sendMessage(type: string, data?: unknown, options?: { exclude?: string[] }): void;
  /** Send a one-off message to a specific user only (all their connections). */
  sendMessageTo(userId: string, type: string, data?: unknown): void;
  /** Forcefully disconnect a player. Triggers onLeave with reason='kicked'. */
  kick(userId: string): void;
  /** Immediately persist all 3 state areas to DO Storage. Use after critical state changes. */
  saveState(): Promise<void>;

  /** Schedule a named timer. Calls onTimer[name] after ms milliseconds. */
  setTimer(name: string, ms: number, data?: unknown): void;
  /** Cancel a named timer. No-op if timer doesn't exist. */
  clearTimer(name: string): void;

  /** Set developer-defined metadata (queryable via HTTP without joining). */
  setMetadata(data: Record<string, unknown>): void;
  /** Get current room metadata. */
  getMetadata(): Record<string, unknown>;
}

/**
 * Room namespace config. Each key in `rooms` is a namespace (e.g. 'game', 'lobby').
 * Client connects via: client.room("namespace", "roomId")
 */
export interface RoomNamespaceConfig {
  /** Reconnect grace period in ms. 0 = immediate onLeave on disconnect. Default: 30000 */
  reconnectTimeout?: number;
  /** Rate limit for send() calls. Default: { actions: 10 } (per second, token bucket) */
  rateLimit?: { actions: number };
  /** Maximum concurrent players. Default: 100 */
  maxPlayers?: number;
  /** Maximum state size in bytes (shared + all player states combined). Default: 1MB */
  maxStateSize?: number;
  /** How often to persist all 3 state areas to DO Storage (ms). Default: 60000 (1 minute). */
  stateSaveInterval?: number;
  /** Time after last save before persisted state is auto-deleted (ms). Default: 86400000 (24 hours). Acts as safety net for orphaned storage. */
  stateTTL?: number;
  /** Public room operation escape hatch for release mode. Default: false. */
  public?:
    | boolean
    | {
        metadata?: boolean;
        join?: boolean;
        action?: boolean;
      };
  /** Preferred access config for room operations. */
  access?: RoomAccess;
  /** Parallel runtime selection policy for room-sticky rollout. */
  runtime?: RoomRuntimeConfig;
  /** Canonical authoritative state config used by the unified Room runtime. */
  state?: RoomStateConfig;
  /** Canonical extension hooks used by the unified Room runtime. */
  hooks?: RoomHooks;
  /** Preferred handler groups. */
  handlers?: RoomHandlers;
}

export interface RoomAccess {
  metadata?: (auth: AuthContext | null, roomId: string) => boolean | Promise<boolean>;
  join?: (auth: AuthContext | null, roomId: string) => boolean | Promise<boolean>;
  action?: (
    auth: AuthContext | null,
    roomId: string,
    actionType: string,
    payload: unknown,
  ) => boolean | Promise<boolean>;
  signal?: (
    auth: AuthContext | null,
    roomId: string,
    event: string,
    payload: unknown,
  ) => boolean | Promise<boolean>;
  media?: RoomMediaAccess;
  admin?: (
    auth: AuthContext | null,
    roomId: string,
    operation: string,
    payload: unknown,
  ) => boolean | Promise<boolean>;
}

export type RoomCreateHandler = (
  room: RoomServerAPI,
  ctx: RoomHandlerContext,
) => Promise<void> | void;

export type RoomJoinHandler = (
  sender: RoomSender,
  room: RoomServerAPI,
  ctx: RoomHandlerContext,
) => Promise<void> | void;

export type RoomLeaveHandler = (
  sender: RoomSender,
  room: RoomServerAPI,
  ctx: RoomHandlerContext,
  reason: 'leave' | 'disconnect' | 'kicked',
) => Promise<void> | void;

export type RoomDestroyHandler = (
  room: RoomServerAPI,
  ctx: RoomHandlerContext,
) => Promise<void> | void;

export type RoomActionHandlers = Record<
  string,
  (
    action: unknown,
    room: RoomServerAPI,
    sender: RoomSender,
    ctx: RoomHandlerContext,
  ) => Promise<unknown> | unknown
>;

export type RoomTimerHandlers = Record<
  string,
  (room: RoomServerAPI, ctx: RoomHandlerContext, data?: unknown) => Promise<void> | void
>;

export interface RoomLifecycleHandlers {
  onCreate?: RoomCreateHandler;
  onJoin?: RoomJoinHandler;
  onLeave?: RoomLeaveHandler;
  onDestroy?: RoomDestroyHandler;
}

export interface RoomMediaAccess {
  subscribe?: (
    auth: AuthContext | null,
    roomId: string,
    payload: unknown,
  ) => boolean | Promise<boolean>;
  publish?: (
    auth: AuthContext | null,
    roomId: string,
    kind: string,
    payload: unknown,
  ) => boolean | Promise<boolean>;
  control?: (
    auth: AuthContext | null,
    roomId: string,
    operation: string,
    payload: unknown,
  ) => boolean | Promise<boolean>;
}

export interface RoomStateConfig {
  actions?: RoomActionHandlers;
  timers?: RoomTimerHandlers;
}

export interface RoomMemberHooks {
  onJoin?: (
    member: RoomMemberInfo,
    room: RoomServerAPI,
    ctx: RoomHandlerContext,
  ) => Promise<void> | void;
  onLeave?: (
    member: RoomMemberInfo,
    room: RoomServerAPI,
    ctx: RoomHandlerContext,
    reason: string,
  ) => Promise<void> | void;
  onStateChange?: (
    member: RoomMemberInfo,
    state: Record<string, unknown>,
    room: RoomServerAPI,
    ctx: RoomHandlerContext,
  ) => Promise<void> | void;
}

export interface RoomStateHooks {
  onStateChange?: (
    delta: Record<string, unknown>,
    room: RoomServerAPI,
    ctx: RoomHandlerContext,
  ) => Promise<void> | void;
}

export interface RoomSignalHooks {
  beforeSend?: (
    event: string,
    payload: unknown,
    sender: RoomSender,
    room: RoomServerAPI,
    ctx: RoomHandlerContext,
  ) => Promise<unknown | false | void> | unknown | false | void;
  onSend?: (
    event: string,
    payload: unknown,
    sender: RoomSender,
    room: RoomServerAPI,
    ctx: RoomHandlerContext,
  ) => Promise<void> | void;
}

export interface RoomMediaHooks {
  beforePublish?: (
    kind: string,
    sender: RoomSender,
    room: RoomServerAPI,
    ctx: RoomHandlerContext,
  ) => Promise<unknown | false | void> | unknown | false | void;
  onPublished?: (
    kind: string,
    sender: RoomSender,
    room: RoomServerAPI,
    ctx: RoomHandlerContext,
  ) => Promise<void> | void;
  onUnpublished?: (
    kind: string,
    sender: RoomSender,
    room: RoomServerAPI,
    ctx: RoomHandlerContext,
  ) => Promise<void> | void;
  onMuteChange?: (
    kind: string,
    sender: RoomSender,
    muted: boolean,
    room: RoomServerAPI,
    ctx: RoomHandlerContext,
  ) => Promise<void> | void;
}

export interface RoomSessionHooks {
  onReconnect?: (
    sender: RoomSender,
    room: RoomServerAPI,
    ctx: RoomHandlerContext,
  ) => Promise<void> | void;
  onDisconnectTimeout?: (
    sender: RoomSender,
    room: RoomServerAPI,
    ctx: RoomHandlerContext,
  ) => Promise<void> | void;
}

export interface RoomHooks {
  lifecycle?: RoomLifecycleHandlers;
  members?: RoomMemberHooks;
  state?: RoomStateHooks;
  signals?: RoomSignalHooks;
  media?: RoomMediaHooks;
  session?: RoomSessionHooks;
}

export interface RoomHandlers {
  lifecycle?: RoomLifecycleHandlers;
  actions?: RoomActionHandlers;
  timers?: RoomTimerHandlers;
}

// ─── Top-level Config (§9) ───
// DB blocks are keyed by namespace ('shared', 'workspace', 'user', etc.)
// Other config is nested under named keys (auth, storage, databaseLive, rooms, ...)

export interface EdgeBaseConfig {
  /** Optional canonical base URL for auth/OAuth redirects and runtime metadata. */
  baseUrl?: string;
  /**
   * Trust reverse-proxy forwarded client IP headers in self-hosted environments.
   * Default: false — only Cloudflare's CF-Connecting-IP is trusted.
   */
  trustSelfHostedProxy?: boolean;
  /**
   * Database blocks. Each key is a namespace:
   * - 'shared': single static DB (no id)
   * - 'workspace', 'user', etc.: dynamic per-id DB
   *   Clients send: edgebase.db('workspace', 'ws-456')
   */
  databases?: Record<string, DbBlock>;

  /** Release mode. false = rules bypassed (dev), true = enforce (prod). Default: false. */
  release?: boolean;

  auth?: AuthConfig;
  email?: EmailConfig;
  /** SMS provider configuration for phone authentication. */
  sms?: SmsConfig;
  storage?: StorageConfig;
  cors?: CorsConfig;
  databaseLive?: DatabaseLiveConfig;
  rateLimiting?: RateLimitingConfig;
  functions?: FunctionsConfig;
  cloudflare?: CloudflareConfig;
  api?: ApiConfig;
  serviceKeys?: ServiceKeysConfig;
  plugins?: PluginInstance[];
  kv?: Record<string, KvNamespaceConfig>;
  d1?: Record<string, D1DatabaseConfig>;
  vectorize?: Record<string, VectorizeConfig>;
  captcha?: boolean | CaptchaConfig;
  push?: PushConfig;
  /** Room namespaces. Key = namespace name (e.g. 'game', 'lobby'). */
  rooms?: Record<string, RoomNamespaceConfig>;
}

export function getDbAccess(dbBlock?: DbBlock): DbAccess | undefined {
  return dbBlock?.access;
}

export function getTableAccess(tableConfig?: TableConfig): TableAccess | undefined {
  return tableConfig?.access;
}

export function getTableHooks(tableConfig?: TableConfig): TableHooks | undefined {
  return tableConfig?.handlers?.hooks;
}

export function getStorageBucketAccess(
  bucketConfig?: StorageBucketConfig,
): StorageBucketAccess | undefined {
  return bucketConfig?.access;
}

export function getStorageHooks(bucketConfig?: StorageBucketConfig): StorageHooks | undefined {
  return bucketConfig?.handlers?.hooks;
}

export function getPushAccess(config?: PushConfig): PushAccess | undefined {
  return config?.access;
}

export function getPushHandlers(config?: PushConfig): PushHandlers | undefined {
  return config?.handlers;
}

export function getAuthAccess(config?: AuthConfig): AuthAccess | undefined {
  return config?.access;
}

export function getAuthHandlers(config?: EdgeBaseConfig): AuthHandlers | undefined {
  return config?.auth?.handlers;
}

export function getAuthEnrichHandler(
  config?: EdgeBaseConfig,
): AuthHandlerHooks['enrich'] | undefined {
  return getAuthHandlers(config)?.hooks?.enrich;
}

export function getMailHooks(config?: EdgeBaseConfig): MailHooks | undefined {
  return getAuthHandlers(config)?.email;
}

export function getRoomAccess(namespaceConfig?: RoomNamespaceConfig): RoomAccess | undefined {
  return namespaceConfig?.access;
}

export function getRoomStateConfig(
  namespaceConfig?: RoomNamespaceConfig,
): RoomStateConfig | undefined {
  if (namespaceConfig?.state) return namespaceConfig.state;
  const handlers = namespaceConfig?.handlers;
  if (!handlers?.actions && !handlers?.timers) return undefined;
  return {
    actions: handlers.actions,
    timers: handlers.timers,
  };
}

export function getRoomHooks(namespaceConfig?: RoomNamespaceConfig): RoomHooks | undefined {
  if (namespaceConfig?.hooks) return namespaceConfig.hooks;
  const handlers = namespaceConfig?.handlers;
  if (!handlers?.lifecycle) return undefined;
  return {
    lifecycle: handlers.lifecycle,
  };
}

export function getRoomHandlers(namespaceConfig?: RoomNamespaceConfig): RoomHandlers | undefined {
  const state = getRoomStateConfig(namespaceConfig);
  const hooks = getRoomHooks(namespaceConfig);
  if (!state?.actions && !state?.timers && !hooks?.lifecycle) {
    return undefined;
  }
  return {
    actions: state?.actions,
    timers: state?.timers,
    lifecycle: hooks?.lifecycle,
  };
}

export function getRoomLifecycleHandlers(
  namespaceConfig?: RoomNamespaceConfig,
): RoomLifecycleHandlers | undefined {
  return getRoomHooks(namespaceConfig)?.lifecycle;
}

export function getRoomActionHandlers(
  namespaceConfig?: RoomNamespaceConfig,
): RoomActionHandlers | undefined {
  return getRoomStateConfig(namespaceConfig)?.actions;
}

export function getRoomTimerHandlers(
  namespaceConfig?: RoomNamespaceConfig,
): RoomTimerHandlers | undefined {
  return getRoomStateConfig(namespaceConfig)?.timers;
}

export function materializeConfig(config: EdgeBaseConfig): EdgeBaseConfig {
  if (!config || typeof config !== 'object') {
    return {};
  }

  if ((config as EdgeBaseConfig & { [MATERIALIZED_CONFIG]?: true })[MATERIALIZED_CONFIG]) {
    return config;
  }

  if (config.plugins?.length) {
    config.databases ??= {};
    for (const plugin of config.plugins) {
      if (!plugin.tables) continue;
      const dbKey = plugin.dbBlock ?? 'shared';
      config.databases[dbKey] ??= { tables: {} };
      config.databases[dbKey].tables ??= {};
      for (const [tableName, tableConfig] of Object.entries(plugin.tables)) {
        const namespacedTable = `${plugin.name}/${tableName}`;
        const existing = config.databases[dbKey].tables?.[namespacedTable];
        if (existing && existing !== tableConfig) {
          throw new Error(
            `Plugin table collision: '${namespacedTable}' already exists in databases.${dbKey}.tables.`,
          );
        }
        config.databases[dbKey].tables![namespacedTable] = tableConfig;
      }
    }
  }

  assertNoLegacyConfigAliases(config);
  normalizeRoomConfig(config);
  normalizeServiceKeysShorthand(config);

  return config;
}

/**
 * Normalize `secret` shorthand on service key entries to the canonical
 * `secretSource: 'inline'` + `inlineSecret` form.
 *
 * This allows users to write:
 *   { kid: 'dev', tier: 'root', scopes: ['*'], secret: 'sk-xxx' }
 * instead of:
 *   { kid: 'dev', tier: 'root', scopes: ['*'], secretSource: 'inline', inlineSecret: 'sk-xxx' }
 */
function normalizeServiceKeysShorthand(config: EdgeBaseConfig): void {
  if (!config.serviceKeys?.keys?.length) return;
  for (const entry of config.serviceKeys.keys) {
    const raw = entry as ServiceKeyEntry & { secret?: string };
    if (raw.secret && !raw.secretSource) {
      raw.secretSource = 'inline';
      raw.inlineSecret = raw.secret;
      delete raw.secret;
    }
  }
}

function hasOwnKey(target: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function legacyConfigError(path: string, guidance: string): Error {
  return new Error(`Legacy config syntax is no longer supported at ${path}. ${guidance}`);
}

const MATERIALIZED_CONFIG = Symbol.for('edgebase.config.materialized');

function hasEquivalentRecordValues(
  left: object | undefined,
  right: object | undefined,
): boolean {
  if (!left || !right) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => rightRecord[key] === leftRecord[key]);
}

function normalizeRoomConfig(config: EdgeBaseConfig): void {
  for (const [namespace, roomConfig] of Object.entries(config.rooms ?? {})) {
    const handlers = roomConfig.handlers;
    if (!handlers) continue;

    if (
      handlers.actions &&
      roomConfig.state?.actions &&
      !hasEquivalentRecordValues(roomConfig.state.actions, handlers.actions)
    ) {
      throw new Error(
        `rooms.${namespace} cannot define both handlers.actions and state.actions. Use the canonical state.actions shape only once.`,
      );
    }
    if (
      handlers.timers &&
      roomConfig.state?.timers &&
      !hasEquivalentRecordValues(roomConfig.state.timers, handlers.timers)
    ) {
      throw new Error(
        `rooms.${namespace} cannot define both handlers.timers and state.timers. Use the canonical state.timers shape only once.`,
      );
    }
    if (
      handlers.lifecycle &&
      roomConfig.hooks?.lifecycle &&
      !hasEquivalentRecordValues(roomConfig.hooks.lifecycle, handlers.lifecycle)
    ) {
      throw new Error(
        `rooms.${namespace} cannot define both handlers.lifecycle and hooks.lifecycle. Use the canonical hooks.lifecycle shape only once.`,
      );
    }

    if (handlers.actions || handlers.timers) {
      roomConfig.state ??= {};
      if (!roomConfig.state.actions && handlers.actions) {
        roomConfig.state.actions = handlers.actions;
      }
      if (!roomConfig.state.timers && handlers.timers) {
        roomConfig.state.timers = handlers.timers;
      }
    }

    if (handlers.lifecycle) {
      roomConfig.hooks ??= {};
      if (!roomConfig.hooks.lifecycle) {
        roomConfig.hooks.lifecycle = handlers.lifecycle;
      }
    }
  }
}

function assertNoLegacyConfigAliases(config: EdgeBaseConfig): void {
  const authConfig = config.auth as Record<string, unknown> | undefined;
  if (authConfig && hasOwnKey(authConfig, 'shardCount')) {
    throw legacyConfigError(
      'auth.shardCount',
      'Auth shards are fixed internally now, so remove shardCount from the config.',
    );
  }

  const functionsConfig = config.functions as Record<string, unknown> | undefined;
  if (functionsConfig && hasOwnKey(functionsConfig, 'hookTimeout')) {
    throw legacyConfigError(
      'functions.hookTimeout',
      'Blocking auth/storage hook timeouts are fixed internally. Remove hookTimeout and use functions.scheduleFunctionTimeout only for scheduled functions.',
    );
  }

  for (const [dbKey, dbBlock] of Object.entries(config.databases ?? {})) {
    const rawDbBlock = dbBlock as DbBlock & Record<string, unknown>;
    if (hasOwnKey(rawDbBlock, 'rules')) {
      throw legacyConfigError(
        `databases.${dbKey}.rules`,
        `Use databases.${dbKey}.access instead.`,
      );
    }

    for (const [tableName, tableConfig] of Object.entries(dbBlock.tables ?? {})) {
      const rawTableConfig = tableConfig as TableConfig & Record<string, unknown>;
      if (hasOwnKey(rawTableConfig, 'rules')) {
        throw legacyConfigError(
          `databases.${dbKey}.tables.${tableName}.rules`,
          `Use databases.${dbKey}.tables.${tableName}.access instead.`,
        );
      }

      for (const [fieldName, fieldConfig] of Object.entries(tableConfig.schema ?? {})) {
        if (fieldConfig === false) continue;
        const rawFieldConfig = fieldConfig as SchemaField & Record<string, unknown>;
        if (hasOwnKey(rawFieldConfig, 'ref')) {
          throw legacyConfigError(
            `databases.${dbKey}.tables.${tableName}.schema.${fieldName}.ref`,
            'Use references instead.',
          );
        }
      }

      for (const [index, migration] of (tableConfig.migrations ?? []).entries()) {
        if (typeof migration.description !== 'string' || migration.description.trim().length === 0) {
          throw new Error(
            `databases.${dbKey}.tables.${tableName}.migrations[${index}].description is required. ` +
              'Add a short summary such as "Add slug column".',
          );
        }
      }
    }
  }

  for (const [bucketName, bucketConfig] of Object.entries(config.storage?.buckets ?? {})) {
    const rawBucketConfig = bucketConfig as StorageBucketConfig & Record<string, unknown>;
    if (hasOwnKey(rawBucketConfig, 'rules')) {
      throw legacyConfigError(
        `storage.buckets.${bucketName}.rules`,
        `Use storage.buckets.${bucketName}.access instead.`,
      );
    }
    if (hasOwnKey(rawBucketConfig, 'maxFileSize')) {
      throw legacyConfigError(
        `storage.buckets.${bucketName}.maxFileSize`,
        `Validate file.size inside storage.buckets.${bucketName}.access.write instead.`,
      );
    }
    if (hasOwnKey(rawBucketConfig, 'allowedMimeTypes')) {
      throw legacyConfigError(
        `storage.buckets.${bucketName}.allowedMimeTypes`,
        `Validate file.contentType inside storage.buckets.${bucketName}.access.write instead.`,
      );
    }
  }

  for (const [namespace, roomConfig] of Object.entries(config.rooms ?? {})) {
    const rawRoomConfig = roomConfig as RoomNamespaceConfig & Record<string, unknown>;
    if (hasOwnKey(rawRoomConfig, 'mode')) {
      throw legacyConfigError(
        `rooms.${namespace}.mode`,
        'Room mode no longer exists. Remove the field and use handlers/access only.',
      );
    }
    if (hasOwnKey(rawRoomConfig, 'onCreate')) {
      throw legacyConfigError(
        `rooms.${namespace}.onCreate`,
        `Move it to rooms.${namespace}.handlers.lifecycle.onCreate.`,
      );
    }
    if (hasOwnKey(rawRoomConfig, 'onJoin')) {
      throw legacyConfigError(
        `rooms.${namespace}.onJoin`,
        `Move it to rooms.${namespace}.handlers.lifecycle.onJoin.`,
      );
    }
    if (hasOwnKey(rawRoomConfig, 'onLeave')) {
      throw legacyConfigError(
        `rooms.${namespace}.onLeave`,
        `Move it to rooms.${namespace}.handlers.lifecycle.onLeave.`,
      );
    }
    if (hasOwnKey(rawRoomConfig, 'onDestroy')) {
      throw legacyConfigError(
        `rooms.${namespace}.onDestroy`,
        `Move it to rooms.${namespace}.handlers.lifecycle.onDestroy.`,
      );
    }
    if (hasOwnKey(rawRoomConfig, 'onAction')) {
      throw legacyConfigError(
        `rooms.${namespace}.onAction`,
        `Move it to rooms.${namespace}.handlers.actions.`,
      );
    }
    if (hasOwnKey(rawRoomConfig, 'onTimer')) {
      throw legacyConfigError(
        `rooms.${namespace}.onTimer`,
        `Move it to rooms.${namespace}.handlers.timers.`,
      );
    }
  }
}

// ─── Function Definition ───

export type FunctionTriggerType = 'db' | 'http' | 'schedule' | 'auth' | 'storage';

export interface DbTrigger {
  type: 'db';
  /** Table name within the DB block. */
  table: string;
  event: 'insert' | 'update' | 'delete';
}

export interface HttpTrigger {
  type: 'http';
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path?: string;
}

export interface ScheduleTrigger {
  type: 'schedule';
  cron: string;
}

export interface AuthTrigger {
  type: 'auth';
  event:
    | 'beforeSignUp'
    | 'afterSignUp'
    | 'beforeSignIn'
    | 'afterSignIn'
    | 'onTokenRefresh'
    | 'beforePasswordReset'
    | 'afterPasswordReset'
    | 'beforeSignOut'
    | 'afterSignOut'
    | 'onDeleteAccount'
    | 'onEmailVerified';
}

export interface StorageTrigger {
  type: 'storage';
  event:
    | 'beforeUpload'
    | 'afterUpload'
    | 'beforeDelete'
    | 'afterDelete'
    | 'beforeDownload'
    | 'onMetadataUpdate';
}

export type FunctionTrigger =
  | DbTrigger
  | HttpTrigger
  | ScheduleTrigger
  | AuthTrigger
  | StorageTrigger;

/** Context object passed to function handlers at runtime. */
export interface FunctionContext {
  /** The incoming HTTP request (for HTTP-triggered functions). */
  request?: Request;
  /** URL path parameters extracted by the router. */
  params?: Record<string, string>;
  /** Authenticated user info, or null if unauthenticated. */
  auth?: {
    userId?: string;
    id?: string;
    role?: string;
    email?: string;
    isAnonymous?: boolean;
    custom?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  } | null;
  /** Environment variables and secrets. */
  env?: Record<string, unknown>;
  /** Admin client surface available in EdgeBase runtime. */
  admin?: unknown;
  /** Convenience database proxy available in EdgeBase runtime. */
  db?: unknown;
  /** Trigger metadata for DB/storage/auth/schedule functions. */
  trigger?: {
    namespace?: string;
    id?: string;
    table?: string;
    event?: string;
  };
  /** Event payload for non-HTTP function triggers. */
  data?: unknown;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Storage trigger file metadata. */
  file?: Record<string, unknown>;
  storage?: unknown;
  analytics?: unknown;
  pluginConfig?: Record<string, unknown>;
}

export interface FunctionDefinition {
  trigger: FunctionTrigger;
  captcha?: boolean;
  handler: (context: unknown) => Promise<unknown>;
}

/** Increment when the public plugin contract changes incompatibly. */
export const CURRENT_PLUGIN_API_VERSION = 1;

export interface PluginManifest {
  /** Human-readable summary shown in CLI and docs. */
  description?: string;
  /** Canonical docs page for this plugin. */
  docsUrl?: string;
  /** Suggested config object for installation/setup tooling. */
  configTemplate?: Record<string, unknown>;
}

// ─── Plugin Instance (Explicit Import Pattern) ───

/**
 * A plugin instance returned by a plugin factory function.
 *
 * @example
 * ```typescript
 * // In edgebase.config.ts:
 * import { stripePlugin } from '@edge-base/plugin-stripe';
 * export default defineConfig({
 *   plugins: [ stripePlugin({ secretKey: process.env.STRIPE_SECRET_KEY! }) ],
 * });
 * ```
 */
export interface PluginInstance {
  /** Plugin unique name (e.g. '@edge-base/plugin-stripe'). Used for namespacing. */
  name: string;
  /** Public plugin contract version used for compatibility checks. */
  pluginApiVersion: number;
  /** Semantic version string (e.g. '1.0.0'). Required for migration support. */
  version?: string;
  /** Manifest metadata used by CLI/docs tooling. */
  manifest?: PluginManifest;
  /** Developer-supplied plugin config (captured by factory closure). */
  config: Record<string, unknown>;
  /** Plugin tables. Keys = table names (plugin.name/ prefix added automatically by CLI). */
  tables?: Record<string, TableConfig>;
  /** DB block for plugin tables. Default: 'shared'. */
  dbBlock?: string;
  /**
   * Database provider required by this plugin.
   * Plugin developers set this based on their data characteristics.
   * - `'do'` (default): Durable Object + SQLite
   * - `'neon'`: Requires Neon PostgreSQL and a configured connection string
   * - `'postgres'`: Requires custom PostgreSQL
   */
  provider?: DbProvider;
  /** Plugin functions. Keys = function names (plugin.name/ prefix added automatically by CLI). */
  functions?: Record<string, FunctionDefinition>;
  /** Auth + storage hooks. Event name → handler. */
  hooks?: Partial<
    Record<AuthTrigger['event'] | StorageTrigger['event'], (context: unknown) => Promise<unknown>>
  >;
  /** Runs once on first deploy with this plugin (version null → version). */
  onInstall?: (context: unknown) => Promise<void>;
  /** Version-keyed migration functions. Run in semver order on deploy when version changes. */
  migrations?: Record<string, (context: unknown) => Promise<void>>;
}

// ─── Helper Functions ───

const VALID_FIELD_TYPES: readonly string[] = [
  'string',
  'text',
  'number',
  'boolean',
  'datetime',
  'json',
];

/** Auto-field names that cannot be type-overridden in user schema. */
const AUTO_FIELD_NAMES: readonly string[] = ['id', 'createdAt', 'updatedAt'];

/**
 * Validate table name uniqueness across all DB blocks. (§18)
 * Throws if the same table name appears in multiple DB blocks.
 */
function validateTableUniqueness(databases: Record<string, DbBlock>): void {
  const seen = new Map<string, string>(); // tableName → dbKey
  for (const [dbKey, dbBlock] of Object.entries(databases)) {
    for (const tableName of Object.keys(dbBlock.tables ?? {})) {
      if (seen.has(tableName)) {
        throw new Error(
          `Table name '${tableName}' is duplicated in '${seen.get(tableName)}' and '${dbKey}'. ` +
            `Table names must be unique across all DB blocks.`,
        );
      }
      seen.set(tableName, dbKey);
    }
  }
}

/**
 * Define an EdgeBase configuration. (§22)
 * Validates the config and throws on invalid values.
 * TypeScript functions are supported — config is bundled via esbuild (§13).
 */
const VALID_DB_PROVIDERS: readonly DbProvider[] = ['do', 'd1', 'neon', 'postgres'];
const VALID_AUTH_PROVIDERS: readonly AuthDbProvider[] = ['d1', 'neon', 'postgres'];
const SERVICE_KEY_KID_PATTERN = /^[A-Za-z0-9-]+$/;

function validateServiceKeysConfig(serviceKeys: ServiceKeysConfig): void {
  const seenKids = new Set<string>();

  for (const [index, entry] of serviceKeys.keys.entries()) {
    if (!entry.kid || typeof entry.kid !== 'string') {
      throw new Error(`serviceKeys.keys[${index}].kid is required and must be a string.`);
    }

    if (!SERVICE_KEY_KID_PATTERN.test(entry.kid)) {
      throw new Error(
        `serviceKeys.keys[${index}].kid '${entry.kid}' is invalid. ` +
          `Use letters, numbers, and hyphens only. ` +
          `Underscore is reserved by the structured key format 'jb_{kid}_{secret}'.`,
      );
    }

    if (seenKids.has(entry.kid)) {
      throw new Error(`Duplicate Service Key kid '${entry.kid}'. Each serviceKeys.keys entry must be unique.`);
    }
    seenKids.add(entry.kid);

    if (entry.secretSource === 'dashboard' && (!entry.secretRef || typeof entry.secretRef !== 'string')) {
      throw new Error(
        `serviceKeys.keys[${index}] (${entry.kid}): secretSource 'dashboard' requires a non-empty secretRef.`,
      );
    }

    if (entry.secretSource === 'inline' && (!entry.inlineSecret || typeof entry.inlineSecret !== 'string')) {
      throw new Error(
        `serviceKeys.keys[${index}] (${entry.kid}): secretSource 'inline' requires a non-empty inlineSecret.`,
      );
    }
  }
}

function validateCloudflareConfig(cloudflare: CloudflareConfig): void {
  if (cloudflare.extraCrons === undefined) return;
  if (!Array.isArray(cloudflare.extraCrons)) {
    throw new Error('cloudflare.extraCrons must be an array of cron strings.');
  }

  for (const [index, cron] of cloudflare.extraCrons.entries()) {
    if (typeof cron !== 'string' || cron.trim().length === 0) {
      throw new Error(`cloudflare.extraCrons[${index}] must be a non-empty cron string.`);
    }
  }
}

export function defineConfig(config: EdgeBaseConfig): EdgeBaseConfig {
  config = materializeConfig(config);

  if (config.trustSelfHostedProxy !== undefined && typeof config.trustSelfHostedProxy !== 'boolean') {
    throw new Error('trustSelfHostedProxy must be a boolean.');
  }

  if (config.serviceKeys?.keys?.length) {
    validateServiceKeysConfig(config.serviceKeys);
  }
  if (config.cloudflare) {
    validateCloudflareConfig(config.cloudflare);
  }

  // ─── Auth Provider Validation ───
  if (config.auth?.provider) {
    if (!VALID_AUTH_PROVIDERS.includes(config.auth.provider)) {
      throw new Error(
        `auth.provider: invalid value '${config.auth.provider}'. Must be one of: ${VALID_AUTH_PROVIDERS.join(', ')}.`,
      );
    }
  }

  if (config.auth?.provider === 'neon' || config.auth?.provider === 'postgres') {
    if (!config.auth.connectionString) {
      throw new Error(
        `auth.provider '${config.auth.provider}' requires a connectionString (env variable name). ` +
          `Example: connectionString: 'AUTH_POSTGRES_URL'`,
      );
    }
  }

  if ((config.auth?.provider === 'd1' || !config.auth?.provider) && config.auth?.connectionString) {
    throw new Error(
      `auth.connectionString is not used with provider '${config.auth?.provider ?? 'd1'}'. ` +
        `Remove connectionString or change auth.provider to 'neon' or 'postgres'.`,
    );
  }

  // ─── DB Block Validation ───
  if (config.databases) {
    // Validate provider settings for each DB block
    for (const [dbKey, dbBlock] of Object.entries(config.databases)) {
      const provider = dbBlock.provider ?? 'do';

      // Provider value validation
      if (!VALID_DB_PROVIDERS.includes(provider)) {
        throw new Error(
          `DB '${dbKey}': invalid provider '${provider}'. Must be one of: ${VALID_DB_PROVIDERS.join(', ')}.`,
        );
      }

      // Multi-tenant blocks (canCreate/access rules or instance: true) cannot use non-DO providers
      const isDynamic = !!(dbBlock.access?.canCreate || dbBlock.access?.access || dbBlock.instance);
      if (isDynamic && provider !== 'do') {
        throw new Error(
          `DB '${dbKey}': provider '${provider}' is not supported on multi-tenant blocks ` +
            `(blocks with canCreate/access rules or instance: true). Multi-tenant blocks require ` +
            `physical isolation via Durable Objects. Remove the provider field or use provider: 'do'.`,
        );
      }

      // connectionString only valid for PostgreSQL providers
      if ((provider === 'do' || provider === 'd1') && dbBlock.connectionString) {
        throw new Error(
          `DB '${dbKey}': connectionString is not used with provider '${provider}'. ` +
            `Remove connectionString or change provider to 'neon' or 'postgres'.`,
        );
      }

      const instanceDiscovery = dbBlock.admin?.instances;
      if (instanceDiscovery) {
        if (!isDynamic) {
          throw new Error(
            `DB '${dbKey}': admin.instances is only supported on dynamic namespaces ` +
              `(blocks with canCreate/access rules or instance: true).`,
          );
        }

        if (instanceDiscovery.placeholder !== undefined && typeof instanceDiscovery.placeholder !== 'string') {
          throw new Error(`DB '${dbKey}': admin.instances.placeholder must be a string.`);
        }
        if (instanceDiscovery.helperText !== undefined && typeof instanceDiscovery.helperText !== 'string') {
          throw new Error(`DB '${dbKey}': admin.instances.helperText must be a string.`);
        }
        if (instanceDiscovery.targetLabel !== undefined && typeof instanceDiscovery.targetLabel !== 'string') {
          throw new Error(`DB '${dbKey}': admin.instances.targetLabel must be a string.`);
        }

        if (instanceDiscovery.source === 'manual') {
          // No additional validation.
        } else if (instanceDiscovery.source === 'table') {
          if (!instanceDiscovery.namespace || typeof instanceDiscovery.namespace !== 'string') {
            throw new Error(`DB '${dbKey}': admin.instances.namespace is required when source is 'table'.`);
          }
          if (!instanceDiscovery.table || typeof instanceDiscovery.table !== 'string') {
            throw new Error(`DB '${dbKey}': admin.instances.table is required when source is 'table'.`);
          }
          if (instanceDiscovery.idField !== undefined && typeof instanceDiscovery.idField !== 'string') {
            throw new Error(`DB '${dbKey}': admin.instances.idField must be a string.`);
          }
          if (instanceDiscovery.labelField !== undefined && typeof instanceDiscovery.labelField !== 'string') {
            throw new Error(`DB '${dbKey}': admin.instances.labelField must be a string.`);
          }
          if (instanceDiscovery.descriptionField !== undefined && typeof instanceDiscovery.descriptionField !== 'string') {
            throw new Error(`DB '${dbKey}': admin.instances.descriptionField must be a string.`);
          }
          if (instanceDiscovery.orderBy !== undefined && typeof instanceDiscovery.orderBy !== 'string') {
            throw new Error(`DB '${dbKey}': admin.instances.orderBy must be a string.`);
          }
          if (instanceDiscovery.limit !== undefined) {
            if (!Number.isInteger(instanceDiscovery.limit) || instanceDiscovery.limit < 1 || instanceDiscovery.limit > 100) {
              throw new Error(`DB '${dbKey}': admin.instances.limit must be an integer between 1 and 100.`);
            }
          }
          if (instanceDiscovery.searchFields !== undefined) {
            if (
              !Array.isArray(instanceDiscovery.searchFields) ||
              instanceDiscovery.searchFields.length === 0 ||
              instanceDiscovery.searchFields.some((field) => typeof field !== 'string' || field.length === 0)
            ) {
              throw new Error(`DB '${dbKey}': admin.instances.searchFields must be a non-empty string array.`);
            }
          }

          const sourceDbBlock = config.databases?.[instanceDiscovery.namespace];
          if (!sourceDbBlock) {
            throw new Error(
              `DB '${dbKey}': admin.instances.namespace '${instanceDiscovery.namespace}' was not found in databases.`,
            );
          }
          const sourceIsDynamic = !!(sourceDbBlock.access?.canCreate || sourceDbBlock.access?.access || sourceDbBlock.instance);
          if (sourceIsDynamic) {
            throw new Error(
              `DB '${dbKey}': admin.instances.namespace '${instanceDiscovery.namespace}' must be a single-instance namespace when source is 'table'.`,
            );
          }
          if (!sourceDbBlock.tables?.[instanceDiscovery.table]) {
            throw new Error(
              `DB '${dbKey}': admin.instances.table '${instanceDiscovery.table}' was not found in namespace '${instanceDiscovery.namespace}'.`,
            );
          }
        } else if (instanceDiscovery.source === 'function') {
          if (typeof instanceDiscovery.resolve !== 'function') {
            throw new Error(`DB '${dbKey}': admin.instances.resolve must be a function when source is 'function'.`);
          }
        } else {
          const unexpectedSource = (instanceDiscovery as { source?: unknown }).source;
          throw new Error(
            `DB '${dbKey}': admin.instances.source '${String(unexpectedSource)}' is invalid. ` +
              `Must be one of: manual, table, function.`,
          );
        }
      }
    }

    // Validate each DB block's table schemas
    for (const [dbKey, dbBlock] of Object.entries(config.databases)) {
      for (const [tableName, tableConfig] of Object.entries(dbBlock.tables ?? {})) {
        if (!tableConfig.schema) continue;
        for (const [field, def] of Object.entries(tableConfig.schema)) {
          // Auto-fields: only `false` (disable) is allowed, type override is blocked
          if (AUTO_FIELD_NAMES.includes(field)) {
            if (def !== false) {
              throw new Error(
                `DB '${dbKey}' table '${tableName}.${field}': auto-field '${field}' cannot be type-overridden. ` +
                  `Use '${field}: false' to disable it, or omit it to use the default.`,
              );
            }
            continue;
          }
          if (def === false) continue;
          if (!def.type) {
            throw new Error(`DB '${dbKey}' table '${tableName}.${field}': 'type' is required.`);
          }
          if (!VALID_FIELD_TYPES.includes(def.type)) {
            throw new Error(
              `DB '${dbKey}' table '${tableName}.${field}': invalid type '${def.type}'. ` +
                `Must be one of: ${VALID_FIELD_TYPES.join(', ')}.`,
            );
          }
        }
      }
    }

    // Validate table name uniqueness (§18)
    validateTableUniqueness(config.databases);
  }

  // ─── Plugin Validation ───
  if (config.plugins) {
    if (!Array.isArray(config.plugins)) {
      throw new Error('plugins must be an array. Example: plugins: [stripePlugin({...})]');
    }
    const seen = new Set<string>();
    for (const p of config.plugins) {
      if (!p.name) throw new Error('Each plugin must have a "name" property.');
      if (p.pluginApiVersion !== CURRENT_PLUGIN_API_VERSION) {
        throw new Error(
          `Plugin '${p.name}' targets pluginApiVersion '${String(p.pluginApiVersion)}', ` +
            `but this EdgeBase build requires '${CURRENT_PLUGIN_API_VERSION}'. ` +
            `Rebuild the plugin against the current @edge-base/plugin-core version.`,
        );
      }
      if (seen.has(p.name)) throw new Error(`Duplicate plugin: '${p.name}'.`);
      seen.add(p.name);
    }

    // Validate provider consistency: plugin provider must match its target dbBlock provider
    for (const p of config.plugins) {
      if (!p.provider || !p.dbBlock) continue;
      const targetBlock = config.databases?.[p.dbBlock];
      if (!targetBlock) continue; // dbBlock may not exist yet (created by merge)
      const blockProvider = targetBlock.provider ?? 'do';
      const pluginProvider = p.provider;
      if (blockProvider !== pluginProvider) {
        throw new Error(
          `Plugin '${p.name}' requires provider '${pluginProvider}' but DB block '${p.dbBlock}' ` +
            `uses provider '${blockProvider}'. All plugins targeting the same DB block must use the same provider.`,
        );
      }
    }
  }

  // ─── Room Config Validation ───
  if (config.rooms) {
    // Detect v1 config structure and provide migration hint
    if (
      (config.rooms as Record<string, unknown>).rooms &&
      typeof (config.rooms as Record<string, unknown>).rooms === 'object'
    ) {
      throw new Error(
        'Room config has changed in v2. Remove the nested "rooms" key — namespaces are now top-level:\n' +
          '  Before: rooms: { rooms: { "game:*": { mode: "direct" } } }\n' +
          '  After:  rooms: { "game": { handlers: { actions: { ... } } } }',
      );
    }
    for (const [ns, def] of Object.entries(config.rooms)) {
      if (def.maxPlayers !== undefined && (def.maxPlayers < 1 || def.maxPlayers > 32768)) {
        throw new Error(`Room namespace '${ns}': maxPlayers must be between 1 and 32768.`);
      }
      if (def.maxStateSize !== undefined && def.maxStateSize < 1024) {
        throw new Error(`Room namespace '${ns}': maxStateSize must be at least 1024 bytes (1KB).`);
      }
      if (def.reconnectTimeout !== undefined && def.reconnectTimeout < 0) {
        throw new Error(`Room namespace '${ns}': reconnectTimeout must be non-negative.`);
      }
      if (def.rateLimit?.actions !== undefined && def.rateLimit.actions < 1) {
        throw new Error(`Room namespace '${ns}': rateLimit.actions must be at least 1.`);
      }
      if (def.handlers?.timers !== undefined) {
        if (typeof def.handlers.timers !== 'object' || def.handlers.timers === null) {
          throw new Error(
            `Room namespace '${ns}': handlers.timers must be an object of named handlers.`,
          );
        }
        for (const timerName of Object.keys(def.handlers.timers)) {
          if (typeof def.handlers.timers[timerName] !== 'function') {
            throw new Error(
              `Room namespace '${ns}': handlers.timers['${timerName}'] must be a function.`,
            );
          }
        }
      }
    }
  }

  Object.defineProperty(config, MATERIALIZED_CONFIG, {
    value: true,
    enumerable: false,
    configurable: false,
  });

  return config;
}

/**
 * Define an App Function.
 *
 * @example
 * // Full definition (DB trigger, schedule, auth hook, or HTTP with explicit trigger)
 * export default defineFunction({
 *   trigger: { type: 'db', table: 'posts', event: 'insert' },
 *   handler: async ({ data, admin }) => { ... },
 * });
 *
 * // Method-export style (HTTP functions — trigger auto-inferred from export name)
 * export const GET = defineFunction(async ({ params, admin }) => { ... });
 * export const POST = defineFunction(async ({ params, auth, admin }) => { ... });
 */
export function defineFunction(definition: FunctionDefinition): FunctionDefinition;
export function defineFunction(handler: (context: unknown) => Promise<unknown>): FunctionDefinition;
export function defineFunction(
  defOrHandler: FunctionDefinition | ((context: unknown) => Promise<unknown>),
): FunctionDefinition {
  if (typeof defOrHandler === 'function') {
    // Method-export form: trigger filled by CLI registry generator (wrapMethodExport)
    return { trigger: { type: 'http' } as HttpTrigger, handler: defOrHandler };
  }
  return defOrHandler;
}
