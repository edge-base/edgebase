function parsePendingCount(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function getPendingWebSocketCount(
  kv: KVNamespace,
  key: string,
): Promise<number> {
  return parsePendingCount(await kv.get(key));
}

export async function acquirePendingWebSocketSlot(
  kv: KVNamespace,
  key: string,
  maxPending: number,
  ttlSeconds: number,
): Promise<boolean> {
  const current = parsePendingCount(await kv.get(key));
  if (current >= maxPending) {
    return false;
  }

  await kv.put(key, String(current + 1), { expirationTtl: ttlSeconds });
  return true;
}

export async function releasePendingWebSocketSlot(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
): Promise<void> {
  const current = parsePendingCount(await kv.get(key));
  if (current <= 1) {
    await kv.delete(key);
    return;
  }

  await kv.put(key, String(current - 1), { expirationTtl: ttlSeconds });
}
