## Summary

Describe the user-visible outcome and the smallest release scope that delivers it.

## Verification

- [ ] `bun run lint --max-warnings=0`
- [ ] `bun run typecheck`
- [ ] `bun test`
- [ ] `bun run build`
- [ ] `bun audit`

## Launch risk

- [ ] Authorization and workspace boundaries were considered.
- [ ] Customer-facing responses expose no provider names, secrets, or internal billing identifiers.
- [ ] New or changed webhook/background work is idempotent.
- [ ] Database changes are backward-compatible and have a recovery plan.
- [ ] New environment variables are documented without including secret values.
- [ ] Public claims match behavior enforced by the server.

## Deployment

List migrations, feature flags, provider configuration, smoke tests, monitoring, and rollback or roll-forward steps. Write “none” where an item does not apply.
