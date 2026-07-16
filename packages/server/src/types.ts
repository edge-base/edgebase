/**
 * Cloudflare Worker environment bindings.
 * Each binding corresponds to a wrangler.toml entry.
 */
export interface Env {
  // ─── Durable Objects ───
  DATABASE: DurableObjectNamespace;
  AUTH: DurableObjectNamespace;
  DATABASE_LIVE: DurableObjectNamespace;
  /** Room DO — per-room state synchronization, members, and signals */
  ROOMS: DurableObjectNamespace;

  // ─── R2 Storage ───
  STORAGE: R2Bucket;

  // ─── KV (legacy OAuth fallback, WebSocket pending) ───
  KV: KVNamespace;

  // ─── Rate Limiting Bindings ───
  GLOBAL_RATE_LIMITER?: RateLimit;
  DB_RATE_LIMITER?: RateLimit;
  STORAGE_RATE_LIMITER?: RateLimit;
  FUNCTIONS_RATE_LIMITER?: RateLimit;
  AUTH_RATE_LIMITER?: RateLimit;
  AUTH_SIGNIN_RATE_LIMITER?: RateLimit;
  AUTH_SIGNUP_RATE_LIMITER?: RateLimit;
  EVENTS_RATE_LIMITER?: RateLimit;

  // ─── D1 (Internal Control Plane + Auth,) ───
  AUTH_DB: D1Database;
  CONTROL_DB: D1Database;

  // ─── Analytics Engine ───
  ANALYTICS?: AnalyticsEngineDataset;

  // ─── Analytics Engine for App Functions ───
  ANALYTICS_APP?: AnalyticsEngineDataset;

  // ─── LogsDO (Analytics log storage for Docker/self-hosted,) ───
  LOGS?: DurableObjectNamespace;

  // ─── Cloudflare API (Analytics Engine SQL API proxy,) ───
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;

  // ─── Static Assets ───
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /** External admin dashboard origin when the dashboard is deployed separately. */
  ADMIN_ORIGIN?: string;

  // ─── Secrets ───
  JWT_USER_SECRET?: string;
  /** Old JWT user secret — valid during 28d grace period after rotate-jwt */
  JWT_USER_SECRET_OLD?: string;
  /** ISO 8601 timestamp of last JWT user key rotation */
  JWT_USER_SECRET_OLD_AT?: string;
  JWT_ADMIN_SECRET?: string;
  /** Old JWT admin secret — valid during 28d grace period after rotate-jwt */
  JWT_ADMIN_SECRET_OLD?: string;
  /** ISO 8601 timestamp of last JWT admin key rotation */
  JWT_ADMIN_SECRET_OLD_AT?: string;
  SERVICE_KEY?: string;

  // ─── Captcha ───
  /** Turnstile secret key — auto-provisioned via deploy or manually set */
  TURNSTILE_SECRET?: string;
  /** Turnstile site key — public, returned to clients via GET /api/config (§34) */
  CAPTCHA_SITE_KEY?: string;
  /** Comma-separated exact hostnames accepted from Turnstile Siteverify. */
  CAPTCHA_HOSTNAMES?: string;
  // ─── Environment Identification ───
  /** Server environment name for Service Key constraints.env evaluation */
  ENVIRONMENT?: string;
  /**
   * CLI-managed trust boundary for forwarded client-IP headers.
   * Cloudflare deploys use `cloudflare`, local CLI dev uses
   * `local-development`, and Docker/portable runtimes use `self-hosted`.
   */
  EDGEBASE_RUNTIME_MODE?: 'cloudflare' | 'local-development' | 'self-hosted';
  /** Ephemeral launcher-owned authentication for loopback self-host control. */
  EDGEBASE_SELF_HOST_CONTROL_SECRET?: string;
  /** Exact immutable app generation admitted by the protected launcher. */
  EDGEBASE_SELF_HOST_APP_GENERATION?: string;
  /** Exact managed-schedule authority digest admitted by the protected launcher. */
  EDGEBASE_SELF_HOST_SCHEDULE_DIGEST?: string;
  /** Ephemeral proof that forwarding headers came from the verified gateway hop. */
  EDGEBASE_SELF_HOST_GATEWAY_SECRET?: string;

  // ─── Push Secrets ───
  /** FCM Service Account JSON string */
  PUSH_FCM_SERVICE_ACCOUNT?: string;
  /** Optional override base URL for mock FCM endpoints in local/Docker test runs. */
  MOCK_FCM_BASE_URL?: string;
  /** Optional internal base URL used for Worker self-calls behind Docker/proxy port mapping. */
  EDGEBASE_INTERNAL_WORKER_URL?: string;
  /** Optional override for email delivery in deployed/local mock environments. */
  EDGEBASE_EMAIL_API_URL?: string;
  /** Generic EmailProvider API key, or Cloudflare Email Service API token. */
  EDGEBASE_EMAIL_API_KEY?: string;
  /** Cloudflare Email Service API token override. */
  EDGEBASE_EMAIL_CLOUDFLARE_API_TOKEN?: string;
  /** Cloudflare account ID for Email Service REST API delivery. */
  EDGEBASE_EMAIL_CLOUDFLARE_ACCOUNT_ID?: string;
  /** Cloudflare Workers send_email binding name. Defaults to EMAIL. */
  EDGEBASE_EMAIL_CLOUDFLARE_BINDING?: string;
  /** Cloudflare Workers send_email binding, when configured as [[send_email]] name = "EMAIL". */
  EMAIL?: { send(message: { to: string; from: string; subject: string; html?: string; text?: string }): Promise<{ messageId?: string }> };
  /** Optional override for SMS delivery in deployed/local mock environments. */
  EDGEBASE_SMS_API_URL?: string;
  /** Test-only flag set by wrangler.test.toml for SDK E2E flows. */
  EDGEBASE_TEST?: string;
  /** Test-only flag that prefers the bundled test config at startup. */
  EDGEBASE_USE_TEST_CONFIG?: string;

  // ─── Dev Mode ───
  /** Enables browser-based first-admin setup for the local dev server. */
  EDGEBASE_ALLOW_PUBLIC_ADMIN_SETUP?: string;
  /** Schema Editor sidecar port — set by CLI dev command via --var */
  EDGEBASE_DEV_SIDECAR_PORT?: string;
}
