import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import { pushRoute } from '../routes/push.js';
import type { Env } from '../types.js';

const sendToTopicMock = vi.fn();
const broadcastMock = vi.fn();
const sendMock = vi.fn();
const subscribeTokenToTopicMock = vi.fn();
const unsubscribeTokenFromTopicMock = vi.fn();

vi.mock('../lib/push-provider.js', () => ({
  createPushProvider: vi.fn(() => ({
    send: sendMock,
    sendToTopic: sendToTopicMock,
    broadcast: broadcastMock,
    subscribeTokenToTopic: subscribeTokenToTopicMock,
    unsubscribeTokenFromTopic: unsubscribeTokenFromTopicMock,
  })),
}));

function createApp() {
  const app = new OpenAPIHono<HonoEnv>();
  app.route('/api/push', pushRoute);
  return app;
}

function createEnv(): Env {
  return {
    KV: {
      put: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Env;
}

describe('Push handlers route integration', () => {
  const afterSendCalls: Array<{ input: Record<string, unknown>; output: Record<string, unknown> }> = [];

  beforeEach(() => {
    afterSendCalls.length = 0;
    sendMock.mockReset();
    sendToTopicMock.mockReset().mockResolvedValue({ success: true });
    broadcastMock.mockReset().mockResolvedValue({ success: true });
    subscribeTokenToTopicMock.mockReset().mockResolvedValue({ success: true });
    unsubscribeTokenFromTopicMock.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    setConfig({});
    vi.clearAllMocks();
  });

  it('applies beforeSend transforms and fires afterSend for topic sends', async () => {
    setConfig(defineConfig({
      serviceKeys: {
        keys: [
          {
            kid: 'push-root',
            tier: 'root',
            scopes: ['*'],
            secretSource: 'inline',
            inlineSecret: 'sk-test',
          },
        ],
      },
      push: {
        fcm: {
          projectId: 'demo-project',
          serviceAccount: '{}',
        },
        handlers: {
          hooks: {
            beforeSend: (_auth, input) => ({
              ...input,
              topic: `prefixed-${input.topic}`,
              payload: {
                ...(input.payload as Record<string, unknown>),
                body: 'transformed-body',
              },
            }),
            afterSend: (_auth, input, output) => {
              afterSendCalls.push({
                input: input as unknown as Record<string, unknown>,
                output: output as unknown as Record<string, unknown>,
              });
            },
          },
        },
      },
    }));

    const app = createApp();
    const response = await app.request('/api/push/send-to-topic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': 'sk-test',
      },
      body: JSON.stringify({
        topic: 'news',
        payload: { title: 'hello' },
      }),
    }, createEnv());

    expect(response.status).toBe(200);
    expect(sendToTopicMock).toHaveBeenCalledWith(
      'prefixed-news',
      expect.objectContaining({
        title: 'hello',
        body: 'transformed-body',
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(afterSendCalls).toHaveLength(1);
    expect(afterSendCalls[0].input).toMatchObject({
      kind: 'topic',
      topic: 'prefixed-news',
    });
    expect(afterSendCalls[0].output).toMatchObject({
      raw: {
        success: true,
      },
    });
  });

  it('rejects invalid beforeSend topic output', async () => {
    setConfig(defineConfig({
      serviceKeys: {
        keys: [
          {
            kid: 'push-root',
            tier: 'root',
            scopes: ['*'],
            secretSource: 'inline',
            inlineSecret: 'sk-test',
          },
        ],
      },
      push: {
        fcm: {
          projectId: 'demo-project',
          serviceAccount: '{}',
        },
        handlers: {
          hooks: {
            beforeSend: () => ({
              kind: 'topic',
              topic: '',
              payload: null as never,
            }),
          },
        },
      },
    }));

    const app = createApp();
    const response = await app.request('/api/push/send-to-topic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': 'sk-test',
      },
      body: JSON.stringify({
        topic: 'news',
        payload: { title: 'hello' },
      }),
    }, createEnv());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'push.hooks.beforeSend must return a topic and payload when overriding topic delivery.',
    });
  });
});
