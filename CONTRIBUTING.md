# Contributing to Cooee

Thanks for helping improve Cooee.

## Development

Cooee uses Bun workspaces. From the repository root:

```bash
bun install --frozen-lockfile
bun run lint --max-warnings=0
bun run typecheck
bun test
bun run build
```

Keep changes focused, add tests for user-facing or API-visible behavior, and do
not commit credentials, private customer data, production exports, or local
environment files.

## Pull requests

Explain what changed, why it changed, and how it was tested. CI must pass before
merge. Changes to public APIs, authentication, billing, tenancy, privacy, or
deployment behavior should also update the relevant documentation or runbook.

## Security

Do not report suspected vulnerabilities in a public issue. Follow
[SECURITY.md](SECURITY.md) to submit a private report.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
