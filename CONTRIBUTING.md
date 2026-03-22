# Contributing to EdgeBase

Thank you for your interest in contributing to EdgeBase! This guide will help you get started.

## Community Guidelines

- Follow the [Code of Conduct](./CODE_OF_CONDUCT.md) in all project spaces
- Use the issue templates for bug reports and feature requests
- Use the pull request template to summarize your change and testing

## Getting Started

1. **Fork** the repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/<your-username>/edgebase.git
   cd edgebase
   ```
3. **Use Node.js 24 (default)**:
   ```bash
   nvm use
   ```
   If you do not use `nvm`, install Node 20.19+; Node 24.x remains the default version used by `.nvmrc` and `.node-version`, while CI verifies both the minimum supported Node 20.19 runtime and the default Node 24 runtime.
4. **Install dependencies**:
   ```bash
   pnpm install
   ```
5. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development

```bash
# Start the dev server
pnpm dev

# Run tests
pnpm test

# Lint
pnpm lint

# Build all packages
pnpm build
```

## Project Structure

```
edgebase/
├── packages/
│   ├── server/       # Worker + Durable Objects (Hono)
│   ├── shared/       # Shared types, config schema
│   ├── cli/          # CLI tool (init, dev, deploy, ...)
│   ├── admin/        # Admin Dashboard (SvelteKit)
│   └── sdk/
│       ├── js/       # JavaScript/TypeScript SDK
│       ├── dart/     # Dart/Flutter SDK
│       ├── swift/    # Swift SDK
│       ├── kotlin/   # Kotlin SDK
│       └── python/   # Python SDK
├── docs/             # Product docs site and guides
└── tools/            # Code generation and maintenance scripts
```

## Pull Request Process

1. Ensure your code passes `pnpm build && pnpm lint && pnpm test`
2. Update documentation if your change affects the public API
3. Write a clear PR description explaining **what** and **why**
4. One feature per PR — keep changes focused
5. If you use stacked PRs, treat CodeQL as required on the final PR targeting `main` or `develop`. Intermediate PRs against temporary branches may show GitHub's CodeQL code-scanning check as `neutral` because the main pipeline does not run there.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(server): add batch delete endpoint
fix(sdk): handle token refresh race condition
docs: update quickstart guide
test(auth): add OAuth flow integration test
```

## Code Style

- **TypeScript**: Follow the existing ESLint config
- **Naming**: `camelCase` for variables/functions, `PascalCase` for types/classes
- **Tests**: Co-locate tests in `test/` directories

## Reporting Issues

- Use [GitHub Issues](https://github.com/edge-base/edgebase/issues)
- Choose the issue template that best matches your report
- Include reproduction steps, expected vs actual behavior
- For security issues, email **edgebase52@gmail.com** instead

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
