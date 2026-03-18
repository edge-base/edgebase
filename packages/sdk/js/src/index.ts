/**
 * @edge-base/sdk — Unified EdgeBase SDK (Client + Admin).
 * Re-exports all public APIs from @edge-base/core, @edge-base/web, and @edge-base/admin.
 */

// Core (shared types, HTTP, Collection, Storage, FieldOps)
export * from '@edge-base/core';

// Client SDK (browser / React Native)
export * from '@edge-base/web';

// Admin SDK (server-side)
export * from '@edge-base/admin';
