/**
 * AuthDO — Empty shell (Phase 3: Auth DO → D1 migration)
 *
 * All auth operations now go through AUTH_DB D1 via auth-d1-service.ts.
 * This class is kept for Cloudflare migration compatibility — existing
 * DO instances won't be deleted, but all new requests return 410 Gone.
 *
 * The class export is required by wrangler.toml's [[durable_objects.bindings]].
 * Add a migration tag to clear old DO storage on next deploy:
 *   [[migrations]]
 *   tag = "v3"
 */
import { DurableObject } from 'cloudflare:workers';

interface AuthEnv {
  AUTH_DB: D1Database;
  KV: KVNamespace;
  [key: string]: unknown;
}

interface OAuthCoordinatorRecord {
  value: string | null;
  expiresAt: number;
  claimId?: string;
  leaseUntil?: number;
  completedValue?: string;
}

export class AuthDO extends DurableObject<AuthEnv> {
  /** Auth data is D1-backed; this DO remains the strong one-shot OAuth coordinator. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/internal/oauth-state' && request.method === 'POST') {
      const body = await request.json() as { key?: unknown; value?: unknown; expiresAt?: unknown };
      if (
        typeof body.key !== 'string'
        || typeof body.value !== 'string'
        || typeof body.expiresAt !== 'number'
      ) return Response.json({ code: 400, message: 'Invalid OAuth state record.' }, { status: 400 });
      await this.ctx.storage.put(`oauth:${body.key}`, {
        value: body.value,
        expiresAt: body.expiresAt,
      });
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (currentAlarm === null || currentAlarm > body.expiresAt) {
        await this.ctx.storage.setAlarm(body.expiresAt);
      }
      return Response.json({ ok: true });
    }

    if (url.pathname === '/internal/oauth-state' && request.method === 'DELETE') {
      const body = await request.json() as { key?: unknown };
      if (typeof body.key !== 'string') {
        return Response.json({ code: 400, message: 'Invalid OAuth state key.' }, { status: 400 });
      }
      const storageKey = `oauth:${body.key}`;
      const record = await this.ctx.storage.get<OAuthCoordinatorRecord>(storageKey);
      if (!record) return Response.json({ value: null, coordinated: false });
      if (record.value === null) return Response.json({ value: null, coordinated: true });
      await this.ctx.storage.put(storageKey, { value: null, expiresAt: record.expiresAt });
      if (record.expiresAt < Date.now()) return Response.json({ value: null, coordinated: true });
      return Response.json({ value: record.value, coordinated: true });
    }

    if (url.pathname === '/internal/oauth-completion/claim' && request.method === 'POST') {
      const body = await request.json() as { key?: unknown; claimId?: unknown; leaseMs?: unknown };
      if (
        typeof body.key !== 'string'
        || typeof body.claimId !== 'string'
        || typeof body.leaseMs !== 'number'
        || body.leaseMs < 1_000
        || body.leaseMs > 60_000
      ) {
        return Response.json({ code: 400, message: 'Invalid OAuth completion claim.' }, { status: 400 });
      }
      const storageKey = `oauth:${body.key}`;
      const record = await this.ctx.storage.get<OAuthCoordinatorRecord>(storageKey);
      if (!record || record.expiresAt <= Date.now() || (record.value === null && !record.completedValue)) {
        if (record?.expiresAt && record.expiresAt <= Date.now()) await this.ctx.storage.delete(storageKey);
        return Response.json({ status: 'missing' });
      }
      if (record.completedValue) {
        return Response.json({ status: 'completed', value: record.completedValue });
      }
      if (record.claimId && record.claimId !== body.claimId && (record.leaseUntil ?? 0) > Date.now()) {
        return Response.json({ status: 'in-progress' });
      }
      const leaseUntil = Date.now() + body.leaseMs;
      const expiresAt = Math.max(record.expiresAt, leaseUntil + 5_000);
      await this.ctx.storage.put(storageKey, {
        ...record,
        claimId: body.claimId,
        leaseUntil,
        expiresAt,
      });
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (currentAlarm === null || currentAlarm > expiresAt) await this.ctx.storage.setAlarm(expiresAt);
      return Response.json({ status: 'claimed', value: record.value });
    }

    if (url.pathname === '/internal/oauth-completion/renew' && request.method === 'POST') {
      const body = await request.json() as { key?: unknown; claimId?: unknown; leaseMs?: unknown };
      if (
        typeof body.key !== 'string'
        || typeof body.claimId !== 'string'
        || typeof body.leaseMs !== 'number'
        || body.leaseMs < 1_000
        || body.leaseMs > 60_000
      ) {
        return Response.json({ code: 400, message: 'Invalid OAuth completion renewal.' }, { status: 400 });
      }
      const storageKey = `oauth:${body.key}`;
      const record = await this.ctx.storage.get<OAuthCoordinatorRecord>(storageKey);
      if (!record || record.claimId !== body.claimId || record.completedValue) {
        return Response.json({ renewed: false });
      }
      const leaseUntil = Date.now() + body.leaseMs;
      const expiresAt = Math.max(record.expiresAt, leaseUntil + 5_000);
      await this.ctx.storage.put(storageKey, { ...record, leaseUntil, expiresAt });
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (currentAlarm === null || currentAlarm > expiresAt) await this.ctx.storage.setAlarm(expiresAt);
      return Response.json({ renewed: true });
    }

    if (url.pathname === '/internal/oauth-completion/checkpoint' && request.method === 'POST') {
      const body = await request.json() as { key?: unknown; claimId?: unknown; value?: unknown };
      if (
        typeof body.key !== 'string'
        || typeof body.claimId !== 'string'
        || typeof body.value !== 'string'
      ) {
        return Response.json({ code: 400, message: 'Invalid OAuth completion checkpoint.' }, { status: 400 });
      }
      const storageKey = `oauth:${body.key}`;
      const record = await this.ctx.storage.get<OAuthCoordinatorRecord>(storageKey);
      if (!record || record.claimId !== body.claimId || record.completedValue) {
        return Response.json({ stored: false }, { status: 409 });
      }
      await this.ctx.storage.put(storageKey, { ...record, value: body.value });
      return Response.json({ stored: true });
    }

    if (url.pathname === '/internal/oauth-completion/complete' && request.method === 'POST') {
      const body = await request.json() as {
        key?: unknown;
        claimId?: unknown;
        value?: unknown;
        expiresAt?: unknown;
      };
      if (
        typeof body.key !== 'string'
        || typeof body.claimId !== 'string'
        || typeof body.value !== 'string'
        || typeof body.expiresAt !== 'number'
      ) {
        return Response.json({ code: 400, message: 'Invalid OAuth completion result.' }, { status: 400 });
      }
      const storageKey = `oauth:${body.key}`;
      const record = await this.ctx.storage.get<OAuthCoordinatorRecord>(storageKey);
      if (!record || record.claimId !== body.claimId || record.completedValue) {
        return Response.json({ stored: false }, { status: 409 });
      }
      await this.ctx.storage.put(storageKey, {
        value: null,
        completedValue: body.value,
        expiresAt: body.expiresAt,
      } satisfies OAuthCoordinatorRecord);
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (currentAlarm === null || currentAlarm > body.expiresAt) {
        await this.ctx.storage.setAlarm(body.expiresAt);
      }
      return Response.json({ stored: true });
    }

    if (url.pathname === '/internal/oauth-completion/release' && request.method === 'POST') {
      const body = await request.json() as { key?: unknown; claimId?: unknown };
      if (typeof body.key !== 'string' || typeof body.claimId !== 'string') {
        return Response.json({ code: 400, message: 'Invalid OAuth completion release.' }, { status: 400 });
      }
      const storageKey = `oauth:${body.key}`;
      const record = await this.ctx.storage.get<OAuthCoordinatorRecord>(storageKey);
      if (record && record.claimId === body.claimId && !record.completedValue) {
        const { claimId: _claimId, leaseUntil: _leaseUntil, ...pending } = record;
        await this.ctx.storage.put(storageKey, pending);
      }
      return Response.json({ released: true });
    }

    if (url.pathname === '/internal/oauth-state-legacy-claim' && request.method === 'POST') {
      const body = await request.json() as { key?: unknown; expiresAt?: unknown };
      if (typeof body.key !== 'string' || typeof body.expiresAt !== 'number') {
        return Response.json({ code: 400, message: 'Invalid OAuth state legacy claim.' }, { status: 400 });
      }
      const storageKey = `oauth:${body.key}`;
      const existing = await this.ctx.storage.get(storageKey);
      if (existing) return Response.json({ claimed: false });
      await this.ctx.storage.put(storageKey, { value: null, expiresAt: body.expiresAt });
      await this.ctx.storage.setAlarm(body.expiresAt);
      return Response.json({ claimed: true });
    }

    // Backup dump — return empty data for legacy CLI backup compatibility
    if (url.pathname === '/internal/backup/dump' || url.pathname === '/internal/backup/dump-users-public') {
      return Response.json({ doName: request.headers.get('X-DO-Name') || 'unknown', tables: {}, users: [] });
    }

    // Backup restore — no-op for legacy CLI restore compatibility
    if (url.pathname === '/internal/backup/restore') {
      return Response.json({ ok: true, message: 'Auth DO migrated to D1. Restore skipped.' });
    }

    // Backup wipe — no-op
    if (url.pathname === '/internal/backup/wipe') {
      return Response.json({ ok: true, message: 'Auth DO migrated to D1. Wipe skipped.' });
    }

    return Response.json(
      { code: 410, message: 'Unsupported Auth DO route. Auth data uses AUTH_DB; OAuth transient state uses internal coordinator routes.' },
      { status: 410 },
    );
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    let nextExpiry: number | null = null;
    const records = await this.ctx.storage.list<OAuthCoordinatorRecord>({
      prefix: 'oauth:',
    });
    for (const [key, record] of records) {
      const effectiveExpiry = Math.max(record.expiresAt, record.leaseUntil ?? 0);
      if (effectiveExpiry <= now) {
        await this.ctx.storage.delete(key);
      } else if (nextExpiry === null || effectiveExpiry < nextExpiry) {
        nextExpiry = effectiveExpiry;
      }
    }
    if (nextExpiry !== null) await this.ctx.storage.setAlarm(nextExpiry);
  }
}
