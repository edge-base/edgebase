export interface RoomMonitoringSnapshot {
  room: string;
  activeConnections: number;
  authenticatedConnections: number;
  updatedAt: string;
}

export interface RoomMonitoringStats {
  activeConnections: number;
  authenticatedConnections: number;
  channels: number;
  channelDetails: Array<{ channel: string; subscribers: number }>;
}

const ROOM_MONITORING_PREFIX = 'monitoring:room:';
const ROOM_MONITORING_TTL_SECONDS = 600;

function emptyRoomMonitoringStats(): RoomMonitoringStats {
  return {
    activeConnections: 0,
    authenticatedConnections: 0,
    channels: 0,
    channelDetails: [],
  };
}

function buildRoomMonitoringKey(room: string): string {
  return `${ROOM_MONITORING_PREFIX}${room}`;
}

function isRoomMonitoringSnapshot(value: unknown): value is RoomMonitoringSnapshot {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.room === 'string'
    && typeof raw.activeConnections === 'number'
    && typeof raw.authenticatedConnections === 'number'
  );
}

export async function persistRoomMonitoringSnapshot(
  kv: KVNamespace | undefined,
  snapshot: RoomMonitoringSnapshot | null,
): Promise<void> {
  if (!kv || !snapshot?.room) return;

  const key = buildRoomMonitoringKey(snapshot.room);
  if (snapshot.activeConnections <= 0) {
    await kv.delete(key);
    return;
  }

  await kv.put(key, JSON.stringify(snapshot), {
    expirationTtl: ROOM_MONITORING_TTL_SECONDS,
  });
}

export async function fetchRoomMonitoringStatsFromKv(
  kv: KVNamespace | undefined,
): Promise<RoomMonitoringStats> {
  if (!kv) return emptyRoomMonitoringStats();

  const snapshots: RoomMonitoringSnapshot[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list({ prefix: ROOM_MONITORING_PREFIX, cursor });
    const pageSnapshots = await Promise.all(
      page.keys.map(async ({ name }) => kv.get(name, 'json')),
    );

    for (const entry of pageSnapshots) {
      if (isRoomMonitoringSnapshot(entry) && entry.activeConnections > 0) {
        snapshots.push(entry);
      }
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const channelDetails = snapshots
    .map((snapshot) => ({
      channel: snapshot.room,
      subscribers: snapshot.activeConnections,
    }))
    .sort((a, b) => b.subscribers - a.subscribers);

  return {
    activeConnections: snapshots.reduce((sum, snapshot) => sum + snapshot.activeConnections, 0),
    authenticatedConnections: snapshots.reduce(
      (sum, snapshot) => sum + snapshot.authenticatedConnections,
      0,
    ),
    channels: channelDetails.length,
    channelDetails,
  };
}
