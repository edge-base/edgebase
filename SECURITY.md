# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in EdgeBase, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email us at **security@edgebase.fun** with:

1. A description of the vulnerability
2. Steps to reproduce the issue
3. Potential impact assessment
4. Any suggested fixes (optional)

We will acknowledge receipt within 48 hours and aim to provide an initial assessment within 5 business days.

## Disclosure Policy

- We follow coordinated disclosure. Please allow us reasonable time to address the issue before public disclosure.
- We will credit reporters in release notes (unless you prefer to remain anonymous).

## Security Best Practices for Deployment

- Always set `release: true` in your `edgebase.config.ts` for production deployments. This disables dev-mode conveniences such as debug token exposure and permissive access rules.
- Configure a proper email/SMS provider in production. Without one, authentication flows may silently skip sending verification emails or SMS.
- Use strong, unique values for `JWT_SECRET` and other secret environment variables.
- Enable access rules to restrict database operations to authorized users.
- Review and restrict CORS origins in your configuration before deploying publicly.
