---
sidebar_position: 3
sidebar_label: Authentication Context Hook
---

# Authentication Context Hook

Use `auth.handlers.hooks.enrich` to inject request-scoped data into `auth.meta` before access checks run.

This is the right place for data such as:

- workspace membership
- organization role
- feature flags
- request-scoped tenancy metadata

## Configuration

```typescript
import { defineConfig } from '@edgebase-fun/shared';

export default defineConfig({
  auth: {
    handlers: {
      hooks: {
        enrich: async (auth, request) => {
          const workspaceRole = await lookupWorkspaceRole(auth.id);
          return {
            workspaceRole,
            requestPath: new URL(request.url).pathname,
          };
        },
      },
    },
  },

  databases: {
    workspace: {
      access: {
        access(auth) {
          return auth?.meta?.workspaceRole === 'member'
            || auth?.meta?.workspaceRole === 'admin';
        },
      },
      tables: {
        docs: {
          access: {
            read(auth) {
              return auth?.meta?.workspaceRole !== undefined;
            },
            insert(auth) {
              return auth?.meta?.workspaceRole === 'admin';
            },
          },
        },
      },
    },
  },
});
```

## Execution Order

```text
Request -> JWT verification -> auth.handlers.hooks.enrich() -> auth.meta merge -> access evaluation
```

## Signature

```typescript
type AuthEnrichHook = (
  auth: AuthContext,
  request: Request,
) => Promise<Record<string, unknown>> | Record<string, unknown>;
```

## Behavior

- Runs only for authenticated requests.
- Timeout is `50ms`.
- On error or timeout, `auth.meta` becomes `{}`.
- Access logic should treat missing `meta` as deny-by-default.

## Where `auth.meta` is available

- database/table `access`
- storage bucket `access`
- database subscription namespace `access`
- room `access`

## Example: Rooms

```typescript
export default defineConfig({
  auth: {
    handlers: {
      hooks: {
        enrich: async (auth) => ({
          workspaceId: await lookupWorkspace(auth.id),
        }),
      },
    },
  },
  rooms: {
    board: {
      access: {
        join(auth) {
          return Boolean(auth?.meta?.workspaceId);
        },
      },
    },
  },
});
```

## See Also

- [Access Rules](/docs/server/access-rules)
- [Room Access Rules](/docs/room/access-rules)
- [Config Reference](/docs/server/config-reference)
