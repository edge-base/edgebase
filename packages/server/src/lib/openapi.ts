type OpenApiSecurityRequirement = Record<string, string[]>;
type OpenApiOperation = Record<string, unknown> & {
  security?: OpenApiSecurityRequirement[];
};
type OpenApiPathItem = Record<string, OpenApiOperation | unknown>;
export type OpenApiSpec = {
  servers?: Array<{ url: string; description?: string }>;
  components?: object & {
    securitySchemes?: Record<string, Record<string, unknown>>;
  };
  paths?: Record<string, OpenApiPathItem>;
};

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

const ADMIN_PUBLIC_PATHS = new Set([
  '/admin/api/setup',
  '/admin/api/setup/status',
  '/admin/api/auth/login',
  '/admin/api/auth/refresh',
]);

const USER_BEARER_PATHS = new Set([
  '/api/auth/link/phone',
  '/api/auth/verify-link-phone',
  '/api/auth/mfa/totp/enroll',
  '/api/auth/mfa/totp/verify',
  '/api/auth/mfa/totp',
  '/api/auth/mfa/factors',
  '/api/auth/change-password',
  '/api/auth/change-email',
  '/api/auth/passkeys/register-options',
  '/api/auth/passkeys/register',
  '/api/auth/passkeys',
  '/api/auth/passkeys/{credentialId}',
  '/api/auth/me',
  '/api/auth/profile',
  '/api/auth/sessions',
  '/api/auth/sessions/{id}',
  '/api/auth/identities',
  '/api/auth/identities/{identityId}',
  '/api/auth/link/email',
  '/api/auth/oauth/link/{provider}',
  '/api/push/register',
  '/api/push/unregister',
  '/api/push/topic/subscribe',
  '/api/push/topic/unsubscribe',
]);

const USER_BEARER_PREFIXES: string[] = [];

const SERVICE_KEY_ONLY_PATHS = new Set([
  '/api/db/broadcast',
  '/api/sql',
  '/api/push/send',
  '/api/push/send-many',
  '/api/push/send-to-token',
  '/api/push/send-to-topic',
  '/api/push/broadcast',
  '/api/push/logs',
  '/api/push/tokens',
  '/api/analytics/query',
  '/api/analytics/events',
]);

const SERVICE_KEY_ONLY_PREFIXES = [
  '/admin/api/internal/',
  '/admin/api/backup/',
  '/api/auth/admin/',
  '/api/kv/',
  '/api/d1/',
  '/api/vectorize/',
];

function isOperation(value: unknown): value is OpenApiOperation {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path.startsWith(prefix));
}

function getSecurityForPath(path: string): OpenApiSecurityRequirement[] | undefined {
  if (ADMIN_PUBLIC_PATHS.has(path)) return undefined;

  if (SERVICE_KEY_ONLY_PATHS.has(path) || hasPrefix(path, SERVICE_KEY_ONLY_PREFIXES)) {
    return [{ serviceKeyAuth: [] }];
  }

  if (path.startsWith('/admin/api/')) {
    return [{ adminBearerAuth: [] }, { serviceKeyAuth: [] }];
  }

  if (USER_BEARER_PATHS.has(path) || hasPrefix(path, USER_BEARER_PREFIXES)) {
    return [{ userBearerAuth: [] }];
  }

  return undefined;
}

export function normalizeOpenApiDocument(spec: OpenApiSpec, origin?: string): OpenApiSpec {
  if (origin) {
    spec.servers = [
      {
        url: origin,
        description: 'Current EdgeBase instance',
      },
    ];
  }

  const components = (spec.components ??= {});
  const securitySchemes = (components.securitySchemes ??= {});

  securitySchemes.adminBearerAuth ??= {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Admin JWT used by the Admin Dashboard.',
  };
  securitySchemes.userBearerAuth ??= {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'User access token for authenticated client endpoints.',
  };
  securitySchemes.serviceKeyAuth ??= {
    type: 'apiKey',
    in: 'header',
    name: 'X-EdgeBase-Service-Key',
    description: 'Scoped service key for internal or server-side operations.',
  };

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    const security = getSecurityForPath(path);
    if (!security) continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !isOperation(operation) || operation.security) continue;
      operation.security = security;
    }
  }

  return spec;
}
