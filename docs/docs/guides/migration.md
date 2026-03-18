---
sidebar_position: 4
---

# Migration Guide

Migrate from Firebase or Supabase to EdgeBase.

## From Firebase

### Key Differences

| Feature | Firebase | EdgeBase |
|---------|----------|----------|
| Database | NoSQL (document) | SQL (SQLite) |
| Schema | Schemaless | Schema-defined |
| Queries | Limited composability | Full SQL, JOINs |
| Auth pricing | $275/100K MAU | Free |
| Self-hosting | ❌ | ✅ 3 modes |

### Mapping Concepts

| Firebase | EdgeBase |
|----------|----------|
| `db.table('posts').add(data)` | `admin.db('app').table('posts').insert(data)` |
| `doc.get()` | `admin.db('app').table('posts').doc(id).get()` |
| `query.where('field', '==', value)` | `admin.db('app').table('posts').where('field', '==', value)` |
| `onSnapshot()` | `admin.db('app').table('posts').onSnapshot()` |
| `firebase.auth().signInWithEmailAndPassword()` | `client.auth.signIn({ email, password })` |
| Firestore Rules | EdgeBase Access Rules |

### Migration Steps

1. **Schema:** Define your schema in `edgebase.config.ts`
2. **Auth:** OAuth providers config is similar; update redirect URLs
3. **Data:** Export Firestore → JSON → import via `admin.table().insertMany()`
4. **Rules:** Convert Firestore rules to EdgeBase rule expressions
5. **SDK:** Replace `firebase` imports with `@edge-base/web`

## From Supabase

### Key Differences

| Feature | Supabase | EdgeBase |
|---------|----------|----------|
| Database | PostgreSQL | SQLite (per-DO) |
| Architecture | Centralized | Edge-distributed |
| Cold start | ~500ms | ~0ms |
| Pricing | $25/month base | $5/month base |

### Mapping Concepts

| Supabase | EdgeBase |
|----------|----------|
| `supabase.from('posts').select()` | `admin.db('app').table('posts').getList()` |
| `supabase.from('posts').insert(data)` | `admin.db('app').table('posts').insert(data)` |
| `.eq('status', 'published')` | `.where('status', '==', 'published')` |
| RLS Policies | Access Rules |
| Edge Functions | App Functions |

### Migration Steps

1. **Schema:** Export PostgreSQL schema → convert to EdgeBase config
2. **Data:** `pg_dump` → JSON → `insertMany()` import
3. **Auth:** Similar OAuth setup; update provider configs
4. **RLS → Rules:** Convert Row Level Security to EdgeBase rule expressions
5. **Functions:** Port Edge Functions to App Functions
