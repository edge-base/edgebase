# EdgeBase Plugin Development Guide

EdgeBase 플러그인은 빌드 타임에 앱으로 병합되는 모듈입니다. 별도 런타임이 생기지 않고, 테이블/함수/훅이 namespaced 리소스로 합쳐집니다.

## 1. 스캐폴딩

```bash
npx edgebase create-plugin my-plugin --with-client js
```

생성되는 구조:

```text
my-plugin/
├── server/
│   ├── src/index.ts
│   ├── package.json
│   └── tsconfig.json
└── client/js/
    ├── src/index.ts
    ├── package.json
    └── tsconfig.json
```

## 2. Server Plugin 작성

```typescript
import { definePlugin } from '@edgebase/plugin-core';

interface MyPluginConfig {
  apiKey: string;
  webhookSecret: string;
}

export const myPlugin = definePlugin<MyPluginConfig>({
  name: 'my-plugin',
  version: '0.1.0',
  manifest: {
    description: 'Example plugin for item processing',
    docsUrl: 'https://edgebase.fun/docs/plugins/creating-plugins',
    configTemplate: {
      apiKey: 'CHANGE_ME',
      webhookSecret: 'CHANGE_ME',
    },
  },

  tables: {
    items: {
      schema: {
        name: { type: 'string', required: true },
        status: { type: 'string', default: 'active' },
        ownerId: { type: 'string' },
      },
      access: {
        read: (auth, row) => auth?.id === row.ownerId,
        insert: (auth) => auth !== null,
        update: (auth, row) => auth?.id === row.ownerId,
        delete: () => false,
      },
      handlers: {
        hooks: {
          beforeInsert: async (auth, data) => ({
            ...data,
            ownerId: auth?.id ?? null,
          }),
        },
      },
    },
  },

  functions: {
    process: {
      trigger: { type: 'http', method: 'POST', path: '/items/process' },
      handler: async (ctx) => {
        if (!ctx.auth) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = (await ctx.request.json()) as Record<string, unknown>;
        const created = await ctx.admin.table('my-plugin/items').insert({
          ...body,
          ownerId: ctx.auth.id,
        });

        return Response.json({
          ok: true,
          apiKeyConfigured: !!ctx.pluginConfig.apiKey,
          item: created,
        });
      },
    },
  },

  hooks: {
    async onTokenRefresh(ctx) {
      return {
        pluginEnabled: true,
      };
    },
  },
});
```

`definePlugin()`은 현재 EdgeBase의 public plugin contract 버전을 자동으로 주입합니다. 일반적인 플러그인 구현에서는 `pluginApiVersion`을 직접 다룰 필요가 없습니다.

## 3. 앱에 설치

```typescript
import { defineConfig } from '@edgebase/shared';
import { myPlugin } from 'my-plugin';

export default defineConfig({
  plugins: [
    myPlugin({
      apiKey: process.env.MY_PLUGIN_API_KEY!,
      webhookSecret: process.env.MY_PLUGIN_WEBHOOK_SECRET!,
    }),
  ],
});
```

배포되면 플러그인 테이블은 `my-plugin/items`처럼 자동 namespace가 붙습니다.

## 4. Client SDK 작성

```typescript
import type { PluginClientFactory } from '@edgebase/plugin-core';

export interface MyPluginClient {
  process(data: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export const createMyPlugin: PluginClientFactory<MyPluginClient> = (client) => ({
  async process(data) {
    return client.functions.call('my-plugin/process', data) as Promise<Record<string, unknown>>;
  },
});
```

## 5. Plugin Manifest

CLI와 문서는 `definePlugin()` 안의 `manifest`를 읽습니다.

```typescript
manifest: {
  description: 'Short description shown by edgebase plugins list',
  docsUrl: 'https://example.com/docs/my-plugin',
  configTemplate: {
    apiKey: 'CHANGE_ME',
    webhookSecret: 'CHANGE_ME',
  },
}
```

`npx edgebase plugins list`는 이 정보를 이용해 설명, 문서 링크, 설정 템플릿을 표시합니다.

## 6. 유닛 테스트

```typescript
import { createMockContext } from '@edgebase/plugin-core';

const ctx = createMockContext<MyPluginConfig>({
  auth: { id: 'user-1', email: 'user@test.dev' },
  pluginConfig: {
    apiKey: 'test-key',
    webhookSecret: 'test-secret',
  },
  body: { name: 'Test Item' },
  params: { id: '123' },
});

const response = await myPlugin({
  apiKey: 'test-key',
  webhookSecret: 'test-secret',
}).functions!.process.handler(ctx);
```

`createMockContext()`는 요청, 인증 정보, body, params와 인메모리 테이블 프록시를 같이 제공합니다.

## 7. 로컬 확인

```bash
npx edgebase plugins list
npx edgebase dev
```

HTTP 함수에 `trigger.path`를 지정했다면 `/api/functions/items/process`처럼 file path 대신 원하는 공개 경로로 노출됩니다.

## 8. 배포

```bash
cd server && npm run build
cd /my-edgebase-project
npx edgebase deploy
```

배포 시 EdgeBase는 플러그인 테이블을 target DB block에 병합하고, 플러그인 함수/훅을 앱 함수 레지스트리에 함께 등록합니다.

## 9. 제거와 정리

플러그인을 제거할 때는 다음 순서를 권장합니다.

```bash
# edgebase.config.ts 에서 my-plugin 제거
npm uninstall my-plugin
npx edgebase deploy
npx edgebase plugins cleanup my-plugin
```

`plugins cleanup`은 namespaced 플러그인 테이블과 internal control-plane D1(`CONTROL_DB`)에 저장된 플러그인 migration metadata를 지웁니다. Cloudflare Edge에서 dynamic Durable Object 인스턴스까지 완전히 정리하려면 `--account-id`와 `--api-token`을 함께 넘겨야 합니다.

## 10. 신뢰 모델

플러그인은 별도 샌드박스 없이 Worker 번들에 합쳐집니다. 즉 `npm install`은 해당 플러그인 코드를 신뢰한다는 의미입니다. 현재 아키텍처는 capability sandbox보다 빌드타임 조합과 명시적 import를 우선합니다.
