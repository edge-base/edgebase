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

export class AuthDO extends DurableObject<AuthEnv> {
  /**
   * All auth endpoints have been migrated to D1.
   * Any remaining requests to this DO return 410 Gone.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

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
      { code: 410, message: 'Auth DO has been migrated to D1. All auth operations use AUTH_DB directly.' },
      { status: 410 },
    );
  }
}
