# EdgeBase PHP Server SDK

Server-only SDK for EdgeBase — authenticated with a Service Key.  
: PHP is server-only (1단계).

## Entry Point

```php
use EdgeBase\Admin\AdminClient;

$admin = new AdminClient('https://your-project.edgebase.fun', getenv('EDGEBASE_SERVICE_KEY'));
```

## Install

```bash
composer install
```

## Run Tests

```bash
# Unit tests only (no server needed)
composer test

# E2E tests (requires running server)
BASE_URL=http://localhost:8688 EDGEBASE_SERVICE_KEY=sk_test composer test
```

## Prerequisites

- PHP 8.1+
- Extensions: `ext-curl`, `ext-json`

## Dev Dependencies

- `phpunit/phpunit ^10`
- `phpstan/phpstan ^1.10`

## Start Server (for E2E)

```bash
cd ../../server
TMPDIR=/tmp XDG_CONFIG_HOME=/tmp npx wrangler dev --config wrangler.test.toml --port 8688
```
