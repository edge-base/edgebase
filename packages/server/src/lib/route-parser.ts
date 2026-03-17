/**
 * Route parser for analytics data collection.
 *
 * Extracts structured metadata from URL path + HTTP method:
 *   category, subcategory, target1, target2, operation
 *
 * Used by logger middleware to enrich log entries for Analytics Engine
 * and LogsDO SQLite storage.
 */

// ─── Types ───

export interface ParsedRoute {
  /** Top-level feature area: auth | db | storage | databaseLive | push | room | function | kv | sql | admin | other */
  category: string;
  /** Feature sub-action: signup | signin | upload | download | connect | broadcast ... */
  subcategory: string;
  /** Primary target: dbNamespace | bucket | functionName | roomNamespace */
  target1: string;
  /** Secondary target: tableName | provider | roomId */
  target2: string;
  /** CRUD operation: getOne | getList | insert | update | delete | batch | execute ... */
  operation: string;
}

// ─── Helpers ───

/** Map HTTP method + path context to a CRUD operation name */
function methodToOperation(method: string, hasId: boolean): string {
  switch (method) {
    case 'GET':    return hasId ? 'getOne' : 'getList';
    case 'POST':   return 'insert';
    case 'PUT':    return 'update';
    case 'PATCH':  return 'update';
    case 'DELETE': return 'delete';
    default:       return 'unknown';
  }
}

// ─── Auth subcategory mapping ───

const AUTH_SUBCATEGORY_MAP: Record<string, string> = {
  'signup':                 'signup',
  'signin':                 'signin',
  'signin/anonymous':       'signinAnonymous',
  'signin/magic-link':      'signinMagicLink',
  'verify-magic-link':      'verifyMagicLink',
  'signin/email-otp':       'signinEmailOtp',
  'verify-email-otp':       'verifyEmailOtp',
  'signin/phone':           'signinPhone',
  'verify-phone':           'verifyPhone',
  'refresh':                'refresh',
  'signout':                'signout',
  'me':                     'me',
  'profile':                'profile',
  'change-email':           'changeEmail',
  'verify-email-change':    'verifyEmailChange',
  'request-password-reset': 'passwordReset',
  'reset-password':         'passwordReset',
  'verify-email':           'verifyEmail',
  'link/email':             'linkEmail',
  'link/phone':             'linkPhone',
  'verify-link-phone':      'verifyLinkPhone',
  'sessions':               'sessions',
};

// ─── Main parser ───

/**
 * Parse a request method + URL path into structured analytics fields.
 *
 * Examples:
 *   parseRoute('POST', '/api/auth/signup')
 *     → { category: 'auth', subcategory: 'signup', target1: '', target2: '', operation: 'signup' }
 *
 *   parseRoute('GET', '/api/db/app/tables/posts/123')
 *     → { category: 'db', subcategory: '', target1: 'app', target2: 'posts', operation: 'getOne' }
 *
 *   parseRoute('POST', '/api/storage/avatars/upload')
 *     → { category: 'storage', subcategory: 'upload', target1: 'avatars', target2: '', operation: 'upload' }
 */
export function parseRoute(method: string, path: string): ParsedRoute {
  const m = method.toUpperCase();
  const segments = path.split('/').filter(Boolean); // ['api', 'auth', 'signup']

  // Default result
  const result: ParsedRoute = {
    category: 'other',
    subcategory: '',
    target1: '',
    target2: '',
    operation: 'unknown',
  };

  // Must start with 'api' or 'admin'
  if (segments[0] === 'admin') {
    result.category = 'admin';
    result.operation = m === 'GET' ? 'read' : 'write';
    // /admin/api/data/{section}
    if (segments[2] === 'data' && segments[3]) {
      result.subcategory = segments[3]; // logs, monitoring, tables, users, etc.
    } else if (segments[2] === 'auth') {
      result.subcategory = 'auth';
    } else if (segments[2] === 'setup') {
      result.subcategory = 'setup';
    }
    return result;
  }

  if (segments[0] !== 'api') return result;

  const feature = segments[1]; // auth, db, storage, etc.

  switch (feature) {
    // ─── Auth ───
    case 'auth': {
      result.category = 'auth';

      // /api/auth/admin/* — admin user management
      if (segments[2] === 'admin') {
        result.subcategory = 'admin';
        // /api/auth/admin/users/:id
        if (segments[3] === 'users') {
          result.target1 = segments[4] || ''; // userId
          result.operation = methodToOperation(m, !!segments[4]);
          // /api/auth/admin/users/:id/revoke, /mfa, /claims
          if (segments[5]) {
            result.subcategory = `admin:${segments[5]}`;
            result.operation = segments[5];
          }
        }
        break;
      }

      // /api/auth/oauth/:provider[/callback]
      if (segments[2] === 'oauth') {
        result.subcategory = 'oauth';
        result.target1 = segments[3] || ''; // provider name
        if (segments[4] === 'callback') {
          result.operation = 'oauthCallback';
        } else {
          result.operation = 'oauthRedirect';
        }
        // /api/auth/oauth/link/:provider
        if (segments[2] === 'oauth' && segments[3] === 'link') {
          result.subcategory = 'oauthLink';
          result.target1 = segments[4] || '';
          result.operation = segments[5] === 'callback' ? 'oauthLinkCallback' : 'oauthLinkRedirect';
        }
        break;
      }

      // /api/auth/passkeys/*
      if (segments[2] === 'passkeys') {
        result.subcategory = 'passkeys';
        result.operation = segments[3] || 'list'; // register-options, register, auth-options, authenticate
        break;
      }

      // /api/auth/mfa/*
      if (segments[2] === 'mfa') {
        result.subcategory = 'mfa';
        result.operation = segments[3] ? `${segments[3]}/${segments[4] || ''}`.replace(/\/$/, '') : 'list';
        break;
      }

      // /api/auth/sessions/:id
      if (segments[2] === 'sessions') {
        result.subcategory = 'sessions';
        result.target1 = segments[3] || '';
        result.operation = m === 'DELETE' ? 'revoke' : 'list';
        break;
      }

      // Standard auth actions: /api/auth/signup, /api/auth/signin, etc.
      const authPath = segments.slice(2).join('/');
      result.subcategory = AUTH_SUBCATEGORY_MAP[authPath] || authPath || 'unknown';
      result.operation = result.subcategory;
      break;
    }

    // ─── Database ───
    case 'db': {
      result.category = 'db';

      // /api/db/subscribe — WebSocket subscription endpoint
      if (segments[2] === 'subscribe') {
        result.category = 'databaseLive';
        result.subcategory = 'connect';
        result.operation = 'connect';
        break;
      }

      // /api/db/connect-check — WebSocket preflight check
      if (segments[2] === 'connect-check') {
        result.category = 'databaseLive';
        result.subcategory = 'connect-check';
        result.operation = 'connectCheck';
        break;
      }

      // /api/db/broadcast — Server-side broadcast
      if (segments[2] === 'broadcast') {
        result.category = 'databaseLive';
        result.subcategory = 'broadcast';
        result.operation = 'broadcast';
        break;
      }

      // Single-instance: /api/db/:namespace/tables/:name[/:id][/:action]
      if (segments[3] === 'tables') {
        result.target1 = segments[2] || '';
        result.target2 = segments[4] ? decodeURIComponent(segments[4]) : ''; // table name
        const recordId = segments[5];
        const action = segments[6];
        if (action) {
          result.operation = action; // e.g., 'export', custom action
        } else {
          result.operation = methodToOperation(m, !!recordId);
        }
        break;
      }

      // Dynamic: /api/db/:namespace/:instanceId/tables/:name[/:id][/:action]
      if (segments[4] === 'tables') {
        result.target1 = segments[2]; // namespace
        result.target2 = segments[5] ? decodeURIComponent(segments[5]) : ''; // table name
        const recordId = segments[6];
        const action = segments[7];
        if (action) {
          result.operation = action;
        } else {
          result.operation = methodToOperation(m, !!recordId);
        }
        break;
      }

      result.operation = methodToOperation(m, false);
      break;
    }

    // ─── Storage ───
    case 'storage': {
      result.category = 'storage';
      const bucket = segments[2] || '';
      result.target1 = bucket;

      // /api/storage/:bucket/upload
      if (segments[3] === 'upload') {
        result.subcategory = 'upload';
        result.operation = 'upload';
        break;
      }

      // /api/storage/:bucket/delete-batch
      if (segments[3] === 'delete-batch') {
        result.subcategory = 'batch';
        result.operation = 'deleteBatch';
        break;
      }

      // /api/storage/:bucket/signed-url(s)
      if (segments[3] === 'signed-url' || segments[3] === 'signed-urls') {
        result.subcategory = 'signedUrl';
        result.operation = 'createSignedUrl';
        break;
      }

      // /api/storage/:bucket/signed-upload-url
      if (segments[3] === 'signed-upload-url') {
        result.subcategory = 'signedUpload';
        result.operation = 'createSignedUploadUrl';
        break;
      }

      // /api/storage/:bucket/multipart/*
      if (segments[3] === 'multipart') {
        result.subcategory = 'multipart';
        result.operation = segments[4] || 'unknown'; // create, upload-part, complete, abort
        break;
      }

      // /api/storage/:bucket/uploads/:uploadId/parts
      if (segments[3] === 'uploads') {
        result.subcategory = 'multipart';
        result.operation = 'listParts';
        break;
      }

      // /api/storage/:bucket/:key.../metadata
      // Check if last segment is 'metadata'
      if (segments.length > 3) {
        const lastSeg = segments[segments.length - 1];
        if (lastSeg === 'metadata') {
          result.subcategory = 'metadata';
          result.operation = m === 'PATCH' ? 'updateMetadata' : 'getMetadata';
          break;
        }
      }

      // /api/storage/:bucket — list
      if (segments.length === 3 && m === 'GET') {
        result.subcategory = 'list';
        result.operation = 'list';
        break;
      }

      // /api/storage/:bucket/:key — file operations
      if (segments.length > 3) {
        switch (m) {
          case 'GET':    result.subcategory = 'download'; result.operation = 'download'; break;
          case 'HEAD':   result.subcategory = 'head';     result.operation = 'head';     break;
          case 'DELETE': result.subcategory = 'delete';   result.operation = 'delete';   break;
          default:       result.operation = 'unknown';
        }
        break;
      }

      result.operation = 'unknown';
      break;
    }

    // ─── Database Live ───
    case 'databaseLive': {
      result.category = 'databaseLive';
      if (segments[2] === 'broadcast') {
        result.subcategory = 'broadcast';
        result.operation = 'broadcast';
      } else {
        result.subcategory = 'connect';
        result.operation = 'connect';
      }
      break;
    }

    // ─── Push ───
    case 'push': {
      result.category = 'push';
      const action = segments[2] || '';
      result.subcategory = action;
      switch (action) {
        case 'register':    result.operation = 'register';    break;
        case 'unregister':  result.operation = 'unregister';  break;
        case 'send':        result.operation = 'send';        break;
        case 'send-many':   result.operation = 'sendMany';    break;
        case 'send-to-token': result.operation = 'sendToToken'; break;
        case 'send-to-topic': result.operation = 'sendToTopic'; break;
        case 'broadcast':   result.operation = 'broadcast';   break;
        case 'tokens':      result.operation = 'listTokens';  break;
        case 'logs':        result.operation = 'listLogs';    break;
        case 'topic':       result.operation = segments[3] || 'topic'; break;
        default:            result.operation = action || 'unknown';
      }
      break;
    }

    // ─── Room ───
    case 'room': {
      result.category = 'room';
      if (segments[2] === 'metadata') {
        result.subcategory = 'metadata';
        result.operation = 'getMetadata';
      } else if (segments[2] === 'connect-check') {
        result.subcategory = 'connect-check';
        result.operation = 'connectCheck';
      } else {
        result.subcategory = 'connect';
        result.operation = 'connect';
      }
      break;
    }

    // ─── Functions ───
    case 'functions': {
      result.category = 'function';
      // /api/functions/:functionName{.+}
      result.target1 = segments.slice(2).join('/') || '';
      result.operation = 'execute';
      break;
    }

    // ─── KV ───
    case 'kv': {
      result.category = 'kv';
      result.target1 = segments[2] || ''; // namespace
      result.operation = 'execute';
      break;
    }

    // ─── SQL ───
    case 'sql': {
      result.category = 'sql';
      result.operation = 'execute';
      break;
    }

    // ─── D1 ───
    case 'd1': {
      result.category = 'd1';
      result.operation = 'execute';
      break;
    }

    // ─── Vectorize ───
    case 'vectorize': {
      result.category = 'vectorize';
      result.target1 = segments[2] || ''; // index name
      result.operation = segments[3] || 'query';
      break;
    }

    // ─── Config ───
    case 'config': {
      result.category = 'config';
      result.operation = m === 'GET' ? 'read' : 'write';
      break;
    }

    // ─── Health ───
    case 'health': {
      result.category = 'health';
      result.operation = 'check';
      break;
    }

    default: {
      result.category = 'other';
      result.subcategory = feature || '';
      result.operation = 'unknown';
    }
  }

  return result;
}
