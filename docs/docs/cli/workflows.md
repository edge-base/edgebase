---
sidebar_position: 1
---

# CLI Workflows

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

This page is organized by real tasks instead of by command name.

## 1. Scaffold And Run Locally

Create a project:

```bash
npm create edgebase@latest my-app
```

Useful variants:

```bash
npm create edgebase@latest my-app -- --no-dev
npm create edgebase@latest my-app -- --open
```

Then run local development:

```bash
cd my-app
npx edgebase dev
```

By default, local dev runs the API on `http://localhost:8787`. The Admin Dashboard is available at `http://localhost:8787/admin`, and `--open` will open it in your browser automatically.

Common `dev` patterns:

```bash
npx edgebase dev --port 8787
npx edgebase dev --host 0.0.0.0
npx edgebase dev --isolated
npx edgebase dev --isolated qa-session
npx edgebase dev --open
```

Use `--isolated` when you need a clean local state directory without disturbing your default dev state.

Use `edgebase dev` as the standard local entrypoint. It reads `edgebase.config.ts` and injects the managed bindings required for local development, including single-instance D1 namespaces.

The starter project does not create a default `posts` table anymore. Define your first DB block in `edgebase.config.ts`, or use the dev dashboard to create a database block, table, or storage bucket and let it write back to config for you.

Raw `wrangler dev` is an advanced/manual path. Use it only when you are intentionally supplying a complete Wrangler config yourself, such as an explicit `--config` test setup.

## 2. Generate Types And Migration Snippets

Generate TypeScript types from the current schema:

```bash
npx edgebase typegen
npx edgebase typegen --output src/edgebase.d.ts
```

Generate a migration snippet:

```bash
npx edgebase migration create add-post-slug
npx edgebase migration create add-post-slug --table posts
```

Use `migration create` when you need a scaffolded SQL snippet to paste back into `edgebase.config.ts`. Use the `--table` form when you want the CLI to infer the next migration version for a specific table.

## 3. Deploy To Cloudflare

Prepare production secrets:

```bash
cp .env.release.example .env.release
```

Deploy:

```bash
npx edgebase deploy
```

Preview only:

```bash
npx edgebase deploy --dry-run
```

CI-oriented destructive schema behavior:

```bash
npx edgebase deploy --if-destructive reject
npx edgebase deploy --if-destructive reset
```

Automation-oriented form:

```bash
edgebase --json --non-interactive deploy
```

If deployment needs a destructive-change confirmation, the CLI returns `needs_input` instead of waiting on a prompt. If Cloudflare auth must be completed in a browser, it returns `needs_user_action` with instructions your agent can hand to the user.

What `deploy` manages for you:

- validates `edgebase.config.ts`
- bundles functions and runtime scaffolding
- uploads `.env.release` secrets when present
- provisions or reuses managed Cloudflare resources such as KV, D1, R2, Vectorize, Hyperdrive, and Turnstile when the project configuration requires them
- writes a deploy manifest under `.edgebase/` so later cleanup can target the same project resources

Before you treat the release as healthy, verify more than a public route:

- hit one public App Function such as `GET /api/functions/ping`
- hit one service-key-backed admin path that exercises managed resources, such as `admin.sql('shared', undefined, 'SELECT 1')` or `admin.auth.listUsers()`

The deploy manifest at `.edgebase/cloudflare-deploy-manifest.json` is also what later `destroy` and cleanup flows use to identify the project's managed Cloudflare resources.

## 4. Inspect And Tear Down A Deployment

Stream logs from the deployed Worker:

```bash
npx edgebase logs
npx edgebase logs --format json
npx edgebase logs --filter status:500
npx edgebase logs --name my-worker
```

Preview a cleanup:

```bash
npx edgebase destroy --dry-run
```

Execute the cleanup:

```bash
npx edgebase destroy --yes
```

If the project manages an R2 `STORAGE` bucket, `destroy` can also wipe the bucket before deletion when it has a reachable Worker URL and Service Key:

```bash
npx edgebase destroy --yes --url https://my-worker.workers.dev --service-key <service-key>
```

`destroy` is intended to leave a deployed project cleanly removed. It deletes the project-scoped managed resources discovered from the deploy manifest and project config rather than deleting arbitrary account assets.

## 5. Move Or Repair Data

Seed local or remote data:

```bash
npx edgebase seed
npx edgebase seed --file edgebase.seed.json
npx edgebase seed --namespace shared
npx edgebase seed --namespace workspace --id demo-tenant
npx edgebase seed --reset
```

`Ctrl+C` is treated as an immediate cancellation for long-running flows such as `seed` and `backup`. Automation should interpret exit code `130` as a user abort rather than as a malformed JSON response.

Use `--namespace` and `--id` for dynamic DB blocks. For single-instance blocks, the CLI can usually infer the namespace automatically.

Export a table:

```bash
npx edgebase export --table posts --url https://my-worker.workers.dev --service-key <service-key>
npx edgebase export --table posts --output artifacts/posts.json
```

Create and restore portable backups:

```bash
npx edgebase backup create --url https://my-worker.workers.dev --service-key <service-key>
npx edgebase backup create --include-secrets --include-storage
npx edgebase backup restore --from ./backup/backup.json --url https://my-worker.workers.dev --service-key <service-key> --yes
```

Automation-oriented restore:

```bash
edgebase --json --non-interactive backup restore --from ./backup/backup.json --url https://my-worker.workers.dev --service-key <service-key> --yes
```

In non-interactive mode, omit `--yes` only if your caller is prepared to handle a `needs_input` response and retry explicitly.

Use provider migration when auth or data namespaces move between D1 and PostgreSQL/Neon:

```bash
npx edgebase migrate
npx edgebase migrate --scope auth
npx edgebase migrate --scope data
npx edgebase migrate --namespace shared
npx edgebase migrate --dry-run --url https://my-worker.workers.dev --service-key <service-key>
```

`migrate` auto-detects provider changes from the saved schema snapshot when possible. If config evaluation is unavailable, pass `--scope` or `--namespace` explicitly.

If you want EdgeBase to create or reconnect a Neon project for a PostgreSQL block, you can also use the optional helper:

```bash
npx edgebase neon setup --namespace shared
```

The core runtime model is still `provider: 'postgres'` plus a connection-string env key in `edgebase.config.ts`. `edgebase neon setup` and the dev dashboard's Neon actions just fill those env values for you.

## 6. Manage Secrets, Keys, And Admin Access

Workers Secrets:

```bash
npx edgebase secret set STRIPE_SECRET_KEY
npx edgebase secret set STRIPE_SECRET_KEY --value sk_live_...
npx edgebase secret list
npx edgebase secret delete STRIPE_SECRET_KEY
```

Service Key and JWT rotation:

```bash
npx edgebase keys list
npx edgebase keys rotate
npx edgebase keys rotate-jwt
```

`keys rotate-jwt` writes the previous JWT secrets back as `*_OLD` values so refresh-token grace periods can continue to work after rotation. Redeploy after rotating JWT secrets.

Reset an admin password:

```bash
npx edgebase admin reset-password --local --email admin@example.com
npx edgebase admin reset-password --local --email admin@example.com --password new-password-123
npx edgebase admin reset-password --url https://my-worker.workers.dev --service-key <service-key>
npx edgebase admin reset-password --email admin@example.com --password new-password-123 --url https://my-worker.workers.dev --service-key <service-key>
```

Use the `--local` form while `edgebase dev` is running and you need to recover the admin account in your local D1 state.

The non-interactive form is the one you want for CI, recovery playbooks, and scripted operations.

## 7. Work With Plugins And Webhooks

Inspect configured plugins:

```bash
npx edgebase plugins list
```

Scaffold a new plugin:

```bash
npx edgebase create-plugin my-plugin
npx edgebase create-plugin my-plugin --with-client js
npx edgebase create-plugin my-plugin --with-client all
```

Clean up a removed plugin's namespaced data:

```bash
npx edgebase plugins cleanup @myorg/plugin-prefix --url https://my-worker.workers.dev --service-key <service-key> -y
```

If the plugin may have touched dynamic Durable Object-backed namespaces on Cloudflare, also pass account credentials:

```bash
npx edgebase plugins cleanup @myorg/plugin-prefix \
  --url https://my-worker.workers.dev \
  --service-key <service-key> \
  --account-id <cloudflare-account-id> \
  --api-token <cloudflare-api-token> \
  -y
```

Simulate incoming webhook events during development:

```bash
npx edgebase webhook-test stripe
npx edgebase webhook-test stripe --event checkout.session.completed
npx edgebase webhook-test stripe --all
```

## 8. Self-Hosting, Shells, And DX

Build and run the Docker image:

```bash
npx edgebase docker build
npx edgebase docker run
npx edgebase docker run --port 3000 --detach
```

Set up shell completion:

```bash
edgebase completion bash >> ~/.bashrc
edgebase completion zsh >> ~/.zshrc
edgebase completion fish > ~/.config/fish/completions/edgebase.fish
```

Check or change telemetry preferences:

```bash
npx edgebase telemetry status
npx edgebase telemetry enable
npx edgebase telemetry disable
```

Upgrade project packages:

```bash
npx edgebase upgrade --check
npx edgebase upgrade
npx edgebase upgrade --target 0.2.0 --force
```

## 9. Set Up WebRTC For Room Media

Provision Cloudflare Calls resources for Room Media (audio/video/screen-share):

```bash
npx edgebase realtime provision
```

This creates the required Calls App and TURN service, then stores the credentials as Workers secrets. You only need to run this once per project.

Common options:

```bash
# Custom naming
npx edgebase realtime provision --app-name my-calls-app --turn-name my-turn

# Force re-create if already exists
npx edgebase realtime provision --force-create-app --force-create-turn

# Skip storing Workers secrets (manual setup)
npx edgebase realtime provision --skip-workers-secrets
```

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your environment.
