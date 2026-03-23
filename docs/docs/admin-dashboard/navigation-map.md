---
sidebar_position: 3
---

# Navigation Map

This page tracks the current Admin Dashboard route surface in the shipped app.

## Primary Navigation

| Section    | Label           | Route                         | Notes                                             |
| ---------- | --------------- | ----------------------------- | ------------------------------------------------- |
| Overview   | Overview        | `/admin`                      | Project home with auto-ranged traffic summary, services, and quick actions |
| Auth       | Users           | `/admin/auth`                 | User list and account actions                     |
| Auth       | Auth Settings   | `/admin/auth/settings`        | Auth provider and email configuration; editable in local dev |
| Auth       | Email Templates | `/admin/auth/email-templates` | Template editing and preview                      |
| Database   | Tables          | `/admin/database/tables`      | Schema explorer plus table-scoped records and query tools |
| Database   | ERD             | `/admin/database/erd`         | Database-level relationship diagram grouped by DB block |
| Database   | SQL             | `/admin/database/sql`         | Standalone SQL console with CodeMirror editor     |
| Storage    | Files           | `/admin/storage`              | Bucket and object browser                         |
| Functions  | Functions       | `/admin/functions`            | Registered function list and execution UI         |
| Push       | Notifications   | `/admin/push`                 | Push notification management                      |
| Analytics  | Overview        | `/admin/analytics`            | Global request metrics                            |
| Analytics  | Events          | `/admin/analytics/events`     | Custom event explorer                             |
| Analytics  | Auth            | `/admin/analytics/auth`       | Auth-specific analytics                           |
| Analytics  | Database        | `/admin/analytics/database`   | Database request analytics                        |
| Analytics  | Storage         | `/admin/analytics/storage`    | Storage request analytics                         |
| Analytics  | Functions       | `/admin/analytics/functions`  | Function analytics                                |
| Monitoring | Logs            | `/admin/logs`                 | Request and runtime logs                          |
| Monitoring | Live            | `/admin/monitoring`           | Active room and database-live connections         |
| System     | API Docs        | `/admin/docs`                 | Embedded docs viewer                              |
| System     | Backup          | `/admin/backup`               | Backup and restore flows                          |
| System     | Project Info    | `/admin/settings`             | Runtime and config overview                       |

## Supporting Routes

These routes exist in the dashboard codebase even when they are not shown as top-level sidebar entries.

| Route                            | Purpose                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| `/admin/login`                   | Admin sign-in screen                                                 |
| `/admin/auth/[userId]`           | User detail page                                                     |
| `/admin/database`                | Database landing route used by nested layouts                        |
| `/admin/database/new`            | Dev-only database block creation flow with optional Neon connection helpers |
| `/admin/database/tables/new`     | New table creation flow                                              |
| `/admin/database/tables/[table]` | Table detail with target-aware records, Query tab, create-row drawer, schema tools, and D1 → Postgres upgrade flow |
| `/admin/database/sql`            | SQL console (also in primary navigation above)                       |
| `/admin/storage/[bucket]`        | Bucket-specific object browser                                       |

## Coverage Note

When you add or remove routes in `packages/admin/src/routes` or `packages/admin/src/lib/components/layout/Sidebar.svelte`, update this page in the same change so the docs stay aligned with the shipped dashboard.
