---
sidebar_position: 5
---

# Backup & Restore

EdgeBase provides a portable backup/restore system that works across all deployment environments — **Cloudflare Edge**, **Docker**, and **Direct (local)**.

## How It Works

```
┌──────────────┐      Service Key Auth      ┌───────────────────┐
│   CLI        │ ─────────────────────────▶  │   Worker          │
│  backup      │                             │                   │
│  create      │  1. List all DOs            │  /admin/api/      │
│              │  2. Dump each DO            │   backup/*        │
│              │  3. Dump D1                 │                   │
│              │  4. Dump R2 (optional)      │   ┌───────────┐   │
│              │  5. Collect secrets          │   │ Database   │   │
│              │     (optional)              │   │ DO         │   │
│              │  6. Config snapshot          │   │ /internal/ │   │
│              │ ◀─────────────────────────  │   │  backup/*  │   │
│  backup.json │      JSON responses         │   └───────────┘   │
└──────────────┘                             └───────────────────┘
```

### Architecture

EdgeBase backup works through **three layers**:

1. **CLI** (`npx edgebase backup`) — orchestrates the entire process, authenticates via Service Key
2. **Worker Admin API** (`/admin/api/backup/*`) — routes requests to individual Durable Objects
3. **DO Internal Endpoints** (`/internal/backup/*`) — each DO dumps/restores its own SQLite data

The CLI never accesses DO data directly. All data flows through the Worker API.

### Two Backup Paths

| Path             | Use Case                               | Method                                             |
| ---------------- | -------------------------------------- | -------------------------------------------------- |
| **Volume Copy**  | Same environment (Docker→Docker)       | Copy `$PERSIST_DIR` or `.wrangler/state/` directly |
| **CLI Portable** | Cross-environment (Edge↔Docker↔Direct) | JSON serialization via API                         |

### What Gets Backed Up

| Component                                   | Included               | Notes                                                                          |
| ------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| **D1 (CONTROL_DB)**                         | ✅ Always              | Plugin versions and internal operational metadata                              |
| **Database DOs** (tables, groups, isolated) | ✅ Always              | All tables + schema DDL                                                        |
| **D1 (AUTH_DB)**                            | ✅ Always              | Users, sessions, OAuth, email tokens, MFA, passkeys, auth indexes/admin tables |
| **R2 Storage Files**                        | 📦 `--include-storage` | Requires explicit opt-in (can be large)                                        |
| **Secrets** (JWT keys, Service Key)         | 🔐 `--include-secrets` | Requires explicit opt-in (sensitive)                                           |
| **Config Snapshot**                         | ✅ Always              | `edgebase.config.ts` serialized                                                |
| **KV Data**                                 | ❌ Never               | TTL-based ephemeral data, auto-regenerates                                     |
| **DatabaseLiveDO**                          | ❌ Never               | Stateless, WebSocket connections aren't restorable                             |

### DO Enumeration

The biggest challenge in backup is **finding all Durable Objects**. EdgeBase solves this differently per environment:

**Cloudflare Edge:**

1. CLI calls Cloudflare REST API to list all DO instances by hex ID
2. Internal D1s (CONTROL_DB, AUTH_DB) are backed up directly via D1 API
3. Database DOs are identified via `_meta` table's `doName` field

**Docker / Direct:**

1. CLI calls Worker's `/admin/api/backup/list-dos`
2. Worker enumerates fixed DOs from config
3. Isolated DOs are discovered by querying membership sources (e.g., workspace IDs)

### Restore Policy: Wipe & Restore

Restore **replaces all existing data** — no merge logic. This guarantees 100% consistency:

1. Restore D1 control-plane data (CONTROL_DB)
2. Restore D1 auth data (AUTH_DB)
3. Wipe orphan DOs (exist in target but not in backup)
4. Restore Database DOs (10 concurrent)
5. Restore R2 files (if included, 10 concurrent)
6. Resync derived auth read models such as `_users_public`
7. Restore secrets last (if included)

### Failure Semantics

Backup and restore are **fail-closed** for required state:

- `backup create` exits non-zero if DO enumeration, any DO dump, `CONTROL_DB`, or `AUTH_DB` dump fails.
- `backup restore` exits non-zero if `CONTROL_DB`, `AUTH_DB`, orphan DO cleanup, database/auth DO restore, or requested R2 restore fails.
- `_users_public` resync is treated as derived state and remains a warning-only step.
- If a backup includes storage metadata, restore must be run from the `.tar.gz` archive unless you explicitly pass `--skip-storage`.
- In `--json` mode, stdout contains only the final JSON result. `backup restore` must be called with `--yes`, and `backup create --include-storage` proceeds non-interactively because `--include-storage` is already an explicit opt-in.

---

## CLI Usage

### Create Backup

```bash
# DB only (default, fast)
npx edgebase backup create --url <URL> --service-key <KEY>

# DB + secrets (for environment migration — preserves JWT validity)
npx edgebase backup create --include-secrets

# DB + R2 files (slow for large buckets)
npx edgebase backup create --include-storage

# Full backup (complete environment transfer)
npx edgebase backup create --include-secrets --include-storage

# Edge environment (uses Cloudflare API for DO enumeration)
npx edgebase backup create --account-id <CF_ACCOUNT_ID> --api-token <CF_API_TOKEN>

# Custom output path
npx edgebase backup create --output /backups/my-backup.json
```

### Restore Backup

```bash
# Restore from JSON
npx edgebase backup restore --from backup.json --url <URL> --service-key <KEY>

# Edge target
npx edgebase backup restore --from backup.json --account-id <ID> --api-token <TOKEN>

# Skip confirmation prompt
npx edgebase backup restore --from backup.json --yes

# Skip specific components during restore
npx edgebase backup restore --from backup.json --skip-secrets
npx edgebase backup restore --from backup.json --skip-storage
```

### Options Reference

| Option                | Command | Description                                 |
| --------------------- | ------- | ------------------------------------------- |
| `--url <url>`         | Both    | Worker URL (or `EDGEBASE_URL` env)          |
| `--service-key <key>` | Both    | Service Key (or `EDGEBASE_SERVICE_KEY` env) |
| `--output <path>`     | Create  | Output file/directory path                  |
| `--include-secrets`   | Create  | Include JWT secrets in backup               |
| `--include-storage`   | Create  | Include R2 files (creates `.tar.gz`)        |
| `--account-id <id>`   | Both    | Cloudflare Account ID (Edge only)           |
| `--api-token <token>` | Both    | Cloudflare API Token (Edge only)            |
| `--from <path>`       | Restore | Path to backup file (`.json` or `.tar.gz`)  |
| `--yes`               | Restore | Skip confirmation prompt                    |
| `--skip-secrets`      | Restore | Don't restore secrets even if present       |
| `--skip-storage`      | Restore | Don't restore R2 files even if present      |

---

## Output Format

### JSON Only (default)

```
edgebase-backup-2026-02-16T21-30-00Z.json
```

### With Storage (`--include-storage`)

```
edgebase-backup-2026-02-16T21-30-00Z.tar.gz
├── backup.json          ← DB data + metadata
└── storage/             ← R2 file binaries
    ├── avatars/user-123.jpg
    └── docs/report.pdf
```

### Backup JSON Structure

```json
{
  "version": "1.1",
  "timestamp": "2026-02-16T17:56:00Z",
  "source": "cloudflare-edge",
  "config": { /* edgebase.config.ts snapshot */ },
  "secrets": { /* --include-secrets only */ },
  "control": {
    "d1": { "_meta": [] }
  },
  "auth": {
    "d1": { "_email_index": [], "_oauth_index": [], ... }
  },
  "databases": {
    "db:posts": { "tables": { "posts": [] } }
  },
  "storage": { /* --include-storage only */ }
}
```

---

## Cross-Environment Migration

| Scenario                       | Options                               | What Happens                                                                   |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------ |
| **Snapshot** (same env)        | Default                               | DB backup only. Secrets already configured                                     |
| **Migration** (keep JWT valid) | `--include-secrets`                   | DB + secrets. Existing tokens remain valid                                     |
| **Full transfer**              | `--include-secrets --include-storage` | 100% data portability                                                          |
| **Restore without secrets**    | Default                               | Target's existing secrets kept. All JWT tokens invalidated → re-login required |

### Example: Edge → Docker Migration

```bash
# 1. Create full backup from Edge
npx edgebase backup create \
  --url https://my-app.workers.dev \
  --service-key sk-xxxx \
  --include-secrets --include-storage \
  --account-id CF_ACCOUNT_ID --api-token CF_API_TOKEN

# 2. Restore to local Docker
npx edgebase backup restore \
  --from edgebase-backup-2026-02-16T21-30-00Z.tar.gz \
  --url http://localhost:8787 \
  --service-key sk-xxxx
```

---

## R2 Storage Backup

R2 backup uses a **two-phase approach** to handle large buckets safely:

1. **List phase** — fetch all object keys (cursor pagination)
2. **Download phase** — download files 10-concurrent with progress display

### Resume Support

If the download is interrupted, the CLI saves a manifest file tracking completion status. On re-run, it automatically detects the incomplete download and offers to resume:

```
? 2,847 files remaining from previous download. Resume? (y/N)
```

> ⚠️ Large R2 buckets (thousands of files / multi-GB) may take significant time. The CLI displays a confirmation prompt with file count and estimated size before starting.

## Table Export

For exporting individual table data (instead of a full backup), use the `export` command:

```bash
npx edgebase export --table posts --url <URL> --service-key <KEY>
```

This calls the Export API (`GET /admin/api/backup/export/:name`) and returns a **JSON array** of all records in the table.

### How It Differs from Backup

|              | `backup create`                          | `export --table`                         |
| ------------ | ---------------------------------------- | ---------------------------------------- |
| **Scope**    | All DOs + D1 + secrets + storage         | Single table                             |
| **Output**   | Full backup JSON/tar.gz                  | JSON array of records                    |
| **Use case** | Environment migration, disaster recovery | Data analysis, external tool integration |

### Handling Special Tables

- **Dynamic DB block tables** (`user:{id}`, `workspace:{id}` etc.) — the Export API automatically discovers all DO instances and merges their records into a single array
- **View tables** — returns `[]` with an `X-EdgeBase-Notice` header explaining that View data is derived and the source table should be exported instead
- **Grouped tables** — routes to the correct group DO and extracts only the requested table

See [`npx edgebase export` options](/docs/cli/reference#export) for full CLI reference.

---

## Security Considerations

- **Service Key required** — all backup API endpoints require `X-EdgeBase-Service-Key` authentication
- **Admin SDK parity** — the same Service Key can be used from any Admin SDK
- **`--include-secrets` warning** — backup file contains sensitive JWT signing keys. File permissions automatically set to `600`
- **Secret rotation caution** — restoring an old backup after `npx edgebase keys rotate` will invalidate all currently issued JWTs if the backup contains old secrets
- **Internal endpoints blocked** — `/internal/backup/*` routes are only accessible within the Worker, not from external requests
