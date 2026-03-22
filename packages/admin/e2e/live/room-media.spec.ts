import { expect, test } from '@playwright/test';

const APP_PORT = process.env['EDGEBASE_ROOM_MEDIA_APP_PORT'] ?? '4175';
const API_PORT = process.env['EDGEBASE_ROOM_MEDIA_API_PORT'] ?? '8796';
const STATIC_ORIGIN = process.env['EDGEBASE_ROOM_MEDIA_STATIC_ORIGIN'] ?? `http://127.0.0.1:${APP_PORT}`;
const API_BASE_URL = process.env['EDGEBASE_ROOM_MEDIA_BASE_URL'] ?? `http://127.0.0.1:${API_PORT}`;
const HARNESS_URL = `${STATIC_ORIGIN}/packages/admin/e2e/support/room-media-harness.html`;
const DEFAULT_ROOM_NAMESPACE = 'test-media-admin';
const SCREEN_SHARE_ROOM_NAMESPACE = 'test-media-screen-share';

const hasCloudflareEnv = Boolean(
  process.env['EDGEBASE_ROOM_MEDIA_CF_ACCOUNT_ID']
    && process.env['EDGEBASE_ROOM_MEDIA_CF_API_TOKEN']
    && process.env['EDGEBASE_ROOM_MEDIA_CF_APP_ID'],
);

async function startHarness(page: import('@playwright/test').Page, options: {
  provider: 'cloudflare_realtimekit' | 'p2p';
  namespace?: string;
  roomId: string;
  email: string;
  password: string;
  mediaMode?: 'browser' | 'synthetic';
}) {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => Boolean((window as any).edgebaseRoomMediaHarness?.start), undefined, {
    timeout: 30_000,
  });
  return page.evaluate((payload) => {
    return (window as any).edgebaseRoomMediaHarness.start(payload);
  }, {
    baseUrl: API_BASE_URL,
    namespace: options.namespace ?? DEFAULT_ROOM_NAMESPACE,
    roomId: options.roomId,
    provider: options.provider,
    email: options.email,
    password: options.password,
    mediaMode: options.mediaMode ?? 'browser',
  });
}

async function cleanupHarness(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    await (window as any).edgebaseRoomMediaHarness.cleanup();
  }).catch(() => {});
}

async function enableAudio(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as any).edgebaseRoomMediaHarness.enableAudio({
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }));
}

async function enableVideo(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as any).edgebaseRoomMediaHarness.enableVideo({
    width: 640,
    height: 360,
    frameRate: 15,
  }));
}

async function startScreenShare(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as any).edgebaseRoomMediaHarness.startScreenShare({
    video: true,
    audio: false,
  }));
}

async function waitForRemoteTrack(page: import('@playwright/test').Page, kind: 'audio' | 'video' | 'screen') {
  try {
    return await page.evaluate((trackKind) => (
      window as any
    ).edgebaseRoomMediaHarness.waitForRemoteTrack(trackKind, 30000), kind);
  } catch (error) {
    const snapshot = await getSnapshot(page).catch(() => null);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nKind: ${kind}\nSnapshot: ${JSON.stringify(snapshot, null, 2)}`,
    );
  }
}

async function waitForRemoteTrackCount(
  page: import('@playwright/test').Page,
  kind: 'audio' | 'video' | 'screen',
  count: number,
) {
  try {
    return await page.evaluate((payload) => (
      window as any
    ).edgebaseRoomMediaHarness.waitForRemoteTrackCount(payload.kind, payload.count, 30000), { kind, count });
  } catch (error) {
    const snapshot = await getSnapshot(page).catch(() => null);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nKind: ${kind}\nCount: ${count}\nSnapshot: ${JSON.stringify(snapshot, null, 2)}`,
    );
  }
}

async function getConnectionStateEventCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as any).edgebaseRoomMediaHarness.getConnectionStateEventCount());
}

async function waitForConnectionState(
  page: import('@playwright/test').Page,
  nextState: string,
  options?: { afterEventCount?: number },
) {
  try {
    return await page.evaluate((payload) => (
      window as any
    ).edgebaseRoomMediaHarness.waitForConnectionState(
      payload.state,
      30000,
      payload.afterEventCount ?? 0,
    ), {
      state: nextState,
      afterEventCount: options?.afterEventCount ?? 0,
    });
  } catch (error) {
    const snapshot = await getSnapshot(page).catch(() => null);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nConnectionState: ${nextState}\nSnapshot: ${JSON.stringify(snapshot, null, 2)}`,
    );
  }
}

async function getSnapshot(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as any).edgebaseRoomMediaHarness.getSnapshot());
}

function getMediaMode(browserName: string, options?: { forceSynthetic?: boolean }): 'browser' | 'synthetic' {
  if (options?.forceSynthetic) {
    return 'synthetic';
  }
  return browserName === 'chromium' ? 'browser' : 'synthetic';
}

async function createMediaContext(
  browser: import('@playwright/test').Browser,
  browserName?: string,
) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    javaScriptEnabled: true,
  });
  if (browserName === 'chromium') {
    await context.grantPermissions(['microphone', 'camera'], { origin: STATIC_ORIGIN });
  }
  return context;
}

test.describe('Room Media live E2E', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ context, browserName }) => {
    if (browserName === 'chromium') {
      await context.grantPermissions(['microphone', 'camera'], { origin: STATIC_ORIGIN });
    }
  });

  test('p2p provider publishes remote audio and video tracks between two browsers', async ({ browser, browserName }) => {
    const roomId = `room-media-p2p-${Date.now()}`;
    const mediaMode = getMediaMode(browserName);
    const contextA = await createMediaContext(browser, browserName);
    const contextB = await createMediaContext(browser, browserName);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await Promise.all([
        startHarness(pageA, {
          provider: 'p2p',
          roomId,
          email: `room-p2p-a-${Date.now()}@test.com`,
          password: 'RoomMedia123!',
          mediaMode,
        }),
        startHarness(pageB, {
          provider: 'p2p',
          roomId,
          email: `room-p2p-b-${Date.now()}@test.com`,
          password: 'RoomMedia123!',
          mediaMode,
        }),
      ]);

      await enableAudio(pageA);
      const remoteAudioOnB = await waitForRemoteTrack(pageB, 'audio');
      await enableVideo(pageA);
      const remoteVideoOnB = await waitForRemoteTrack(pageB, 'video');
      await enableAudio(pageB);
      const remoteAudioOnA = await waitForRemoteTrack(pageA, 'audio');
      await enableVideo(pageB);
      const remoteVideoOnA = await waitForRemoteTrack(pageA, 'video');

      expect(remoteAudioOnA.kind).toBe('audio');
      expect(remoteAudioOnB.kind).toBe('audio');
      expect(remoteVideoOnA.kind).toBe('video');
      expect(remoteVideoOnB.kind).toBe('video');

      const [snapshotA, snapshotB] = await Promise.all([
        getSnapshot(pageA),
        getSnapshot(pageB),
      ]);

      expect(snapshotA.failures).toEqual([]);
      expect(snapshotB.failures).toEqual([]);
      expect(snapshotA.remoteTracks.some((entry: { kind: string }) => entry.kind === 'audio')).toBe(true);
      expect(snapshotA.remoteTracks.some((entry: { kind: string }) => entry.kind === 'video')).toBe(true);
      expect(snapshotB.remoteTracks.some((entry: { kind: string }) => entry.kind === 'audio')).toBe(true);
      expect(snapshotB.remoteTracks.some((entry: { kind: string }) => entry.kind === 'video')).toBe(true);
    } finally {
      await Promise.all([cleanupHarness(pageA), cleanupHarness(pageB)]);
      await Promise.all([contextA.close(), contextB.close()]);
    }
  });

  test('cloudflare_realtimekit provider publishes remote audio and video tracks between two browsers', async ({ browser, browserName }) => {
    test.skip(!hasCloudflareEnv, 'Cloudflare RealtimeKit credentials are not configured for live media E2E.');

    const roomId = `room-media-cloudflare-${Date.now()}`;
    const mediaMode = getMediaMode(browserName);
    const contextA = await createMediaContext(browser, browserName);
    const contextB = await createMediaContext(browser, browserName);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await Promise.all([
        startHarness(pageA, {
          provider: 'cloudflare_realtimekit',
          roomId,
          email: `room-cloudflare-a-${Date.now()}@test.com`,
          password: 'RoomMedia123!',
          mediaMode,
        }),
        startHarness(pageB, {
          provider: 'cloudflare_realtimekit',
          roomId,
          email: `room-cloudflare-b-${Date.now()}@test.com`,
          password: 'RoomMedia123!',
          mediaMode,
        }),
      ]);

      await enableAudio(pageA);
      const remoteAudioOnB = await waitForRemoteTrack(pageB, 'audio');
      await enableVideo(pageA);
      const remoteVideoOnB = await waitForRemoteTrack(pageB, 'video');
      await enableAudio(pageB);
      const remoteAudioOnA = await waitForRemoteTrack(pageA, 'audio');
      await enableVideo(pageB);
      const remoteVideoOnA = await waitForRemoteTrack(pageA, 'video');

      expect(remoteAudioOnA.kind).toBe('audio');
      expect(remoteAudioOnB.kind).toBe('audio');
      expect(remoteVideoOnA.kind).toBe('video');
      expect(remoteVideoOnB.kind).toBe('video');

      const [snapshotA, snapshotB] = await Promise.all([
        getSnapshot(pageA),
        getSnapshot(pageB),
      ]);

      expect(snapshotA.failures).toEqual([]);
      expect(snapshotB.failures).toEqual([]);
      expect(snapshotA.remoteTracks.some((entry: { kind: string }) => entry.kind === 'audio')).toBe(true);
      expect(snapshotA.remoteTracks.some((entry: { kind: string }) => entry.kind === 'video')).toBe(true);
      expect(snapshotB.remoteTracks.some((entry: { kind: string }) => entry.kind === 'audio')).toBe(true);
      expect(snapshotB.remoteTracks.some((entry: { kind: string }) => entry.kind === 'video')).toBe(true);
    } finally {
      await Promise.all([cleanupHarness(pageA), cleanupHarness(pageB)]);
      await Promise.all([contextA.close(), contextB.close()]);
    }
  });

  test('cloudflare_realtimekit reconnects after a network interruption and can publish new media', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'Reconnect live E2E currently runs on Chromium only.');
    test.skip(!hasCloudflareEnv, 'Cloudflare RealtimeKit credentials are not configured for live media E2E.');

    const roomId = `room-media-cloudflare-reconnect-${Date.now()}`;
    const contextA = await createMediaContext(browser, browserName);
    const contextB = await createMediaContext(browser, browserName);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await Promise.all([
        startHarness(pageA, {
          provider: 'cloudflare_realtimekit',
          roomId,
          email: `room-cloudflare-reconnect-a-${Date.now()}@test.com`,
          password: 'RoomMedia123!',
          mediaMode: 'browser',
        }),
        startHarness(pageB, {
          provider: 'cloudflare_realtimekit',
          roomId,
          email: `room-cloudflare-reconnect-b-${Date.now()}@test.com`,
          password: 'RoomMedia123!',
          mediaMode: 'browser',
        }),
      ]);

      await enableAudio(pageA);
      await waitForRemoteTrack(pageB, 'audio');

      const reconnectEventCount = await getConnectionStateEventCount(pageA);
      await contextA.setOffline(true);
      await waitForConnectionState(pageA, 'reconnecting', { afterEventCount: reconnectEventCount });

      const connectedEventCount = await getConnectionStateEventCount(pageA);
      await contextA.setOffline(false);
      await waitForConnectionState(pageA, 'connected', { afterEventCount: connectedEventCount });

      await enableVideo(pageA);
      const remoteVideoOnB = await waitForRemoteTrack(pageB, 'video');

      expect(remoteVideoOnB.kind).toBe('video');
      expect((await getSnapshot(pageA)).failures).toEqual([]);
      expect((await getSnapshot(pageB)).failures).toEqual([]);
    } finally {
      await Promise.all([cleanupHarness(pageA), cleanupHarness(pageB)]);
      await Promise.all([contextA.close(), contextB.close()]);
    }
  });

  test('cloudflare_realtimekit delivers audio and video from one publisher to two remote peers', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', '3-party live E2E currently runs on Chromium only.');
    test.skip(!hasCloudflareEnv, 'Cloudflare RealtimeKit credentials are not configured for live media E2E.');

    const roomId = `room-media-cloudflare-3p-${Date.now()}`;
    const contextA = await createMediaContext(browser, browserName);
    const contextB = await createMediaContext(browser, browserName);
    const contextC = await createMediaContext(browser, browserName);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const pageC = await contextC.newPage();

    try {
      await Promise.all([
        startHarness(pageA, {
          provider: 'cloudflare_realtimekit',
          roomId,
          email: `room-cloudflare-3p-a-${Date.now()}@test.com`,
          password: 'RoomMedia123!',
          mediaMode: 'browser',
        }),
        startHarness(pageB, {
          provider: 'cloudflare_realtimekit',
          roomId,
          email: `room-cloudflare-3p-b-${Date.now()}@test.com`,
          password: 'RoomMedia123!',
          mediaMode: 'browser',
        }),
        startHarness(pageC, {
          provider: 'cloudflare_realtimekit',
          roomId,
          email: `room-cloudflare-3p-c-${Date.now()}@test.com`,
          password: 'RoomMedia123!',
          mediaMode: 'browser',
        }),
      ]);

      await enableAudio(pageA);
      await enableVideo(pageA);
      await Promise.all([
        waitForRemoteTrack(pageB, 'audio'),
        waitForRemoteTrack(pageB, 'video'),
        waitForRemoteTrack(pageC, 'audio'),
        waitForRemoteTrack(pageC, 'video'),
      ]);

      await enableAudio(pageB);
      await enableVideo(pageB);
      await Promise.all([
        waitForRemoteTrackCount(pageA, 'audio', 1),
        waitForRemoteTrackCount(pageA, 'video', 1),
        waitForRemoteTrackCount(pageC, 'audio', 2),
        waitForRemoteTrackCount(pageC, 'video', 2),
      ]);

      const [snapshotA, snapshotB, snapshotC] = await Promise.all([
        getSnapshot(pageA),
        getSnapshot(pageB),
        getSnapshot(pageC),
      ]);

      expect(snapshotA.failures).toEqual([]);
      expect(snapshotB.failures).toEqual([]);
      expect(snapshotC.failures).toEqual([]);
      expect(snapshotC.remoteTracks.filter((entry: { kind: string }) => entry.kind === 'audio').length).toBeGreaterThanOrEqual(2);
      expect(snapshotC.remoteTracks.filter((entry: { kind: string }) => entry.kind === 'video').length).toBeGreaterThanOrEqual(2);
    } finally {
      await Promise.all([cleanupHarness(pageA), cleanupHarness(pageB), cleanupHarness(pageC)]);
      await Promise.all([contextA.close(), contextB.close(), contextC.close()]);
    }
  });

  test('p2p provider delivers synthetic screen share to a remote peer', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'Screen-share live E2E currently runs on Chromium only.');

    const roomId = `room-media-p2p-screen-${Date.now()}`;
    const contextA = await createMediaContext(browser, browserName);
    const contextB = await createMediaContext(browser, browserName);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await Promise.all([
        startHarness(pageA, {
          provider: 'p2p',
          namespace: SCREEN_SHARE_ROOM_NAMESPACE,
          roomId,
          email: `admin-room-p2p-screen-a-${Date.now()}@test.com`,
          password: 'RoomMedia123!',
          mediaMode: 'synthetic',
        }),
        startHarness(pageB, {
          provider: 'p2p',
          namespace: SCREEN_SHARE_ROOM_NAMESPACE,
          roomId,
          email: `room-p2p-screen-b-${Date.now()}@test.com`,
          password: 'RoomMedia123!',
          mediaMode: 'synthetic',
        }),
      ]);

      await startScreenShare(pageA);
      const remoteScreenOnB = await waitForRemoteTrack(pageB, 'screen');

      expect(remoteScreenOnB.kind).toBe('screen');
      expect((await getSnapshot(pageA)).failures).toEqual([]);
      expect((await getSnapshot(pageB)).failures).toEqual([]);
    } finally {
      await Promise.all([cleanupHarness(pageA), cleanupHarness(pageB)]);
      await Promise.all([contextA.close(), contextB.close()]);
    }
  });
});
