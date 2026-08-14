# Self-hosting Cooee

This guide covers the supported single-origin self-hosted deployment. The
combined Cooee service serves the operator dashboard, public changelogs, and
API. PostgreSQL stores application data, a cron
service runs scheduled generation, and the optional MCP service reads from the
public API.

## Railway template

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/cooee)

- PostgreSQL;
- a public Cooee service using `railway.json`;
- a cron service using `railway.cron.json`; and
- a public, read-only MCP service using `railway.mcp.json`.

The template disables billing and hosted-only behavior. It does not create
third-party accounts or credentials for GitHub, OpenAI, Cloudflare, email, or
object storage.

## Required configuration

Railway treats its deployed services as production. The Cooee application will
refuse to start until every required value is present and valid.

| Variable                 | Purpose                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `APP_URL`                | Public HTTPS origin of the combined Cooee service, without a path      |
| `BETTER_AUTH_URL`        | Same HTTPS origin as `APP_URL`                                         |
| `BETTER_AUTH_SECRET`     | Random value at least 32 characters long                               |
| `DATABASE_URL`           | PostgreSQL connection URL; use `${{Postgres.DATABASE_URL}}` on Railway |
| `GITHUB_CLIENT_ID`       | GitHub OAuth app client ID                                             |
| `GITHUB_CLIENT_SECRET`   | GitHub OAuth app client secret                                         |
| `GITHUB_APP_ID`          | GitHub App numeric ID                                                  |
| `GITHUB_APP_SLUG`        | GitHub App slug                                                        |
| `GITHUB_APP_PRIVATE_KEY` | Complete PEM private key, including line breaks                        |
| `GITHUB_WEBHOOK_SECRET`  | Strong secret configured on the GitHub App webhook                     |
| `OPENAI_API_KEY`         | API key used for changelog drafting                                    |

Recommended defaults:

```dotenv
NODE_ENV=production
BILLING_ENABLED=false
VITE_BILLING_ENABLED=false
OPENAI_MODEL=gpt-5.4-mini
HOST=0.0.0.0
```

Do not set `COOEE_RUNTIME_MODE=hosted` for an ordinary self-hosted deployment.
Hosted mode additionally requires object storage and a customer-facing support
URL and is intended for operators offering Cooee as a service.

## GitHub configuration

GitHub OAuth handles account sign-in. The GitHub App grants access to selected
repositories and delivers installation, pull-request, and release webhooks.

For `https://changelog.example.com`, configure:

```text
OAuth callback:      https://changelog.example.com/api/auth/callback/github
GitHub App callback: https://changelog.example.com/api/github/callback
GitHub App webhook:  https://changelog.example.com/api/webhooks/github
```

Grant the GitHub App read-only pull-request, contents, and metadata permissions.
Subscribe it to `pull_request`, `release`, `installation`, and
`installation_repositories` events.
Use a unique webhook secret and place the same value in
`GITHUB_WEBHOOK_SECRET`.

After changing callback URLs or environment variables, redeploy the Cooee and
cron services. Do not copy private keys or webhook secrets into issues, logs, or
screenshots.

### Coding-agent PR labels

Cooee's GitHub App remains read-only. To have Codex, Claude, and other
skill-compatible coding agents classify the PR they are working on, install the
Cooee PR Labels skill in the developer's GitHub CLI environment:

```bash
npx skills add cooeehq/cooee --skill cooee-pr-labels -g
gh auth login
```

The skill uses the developer's `gh` authority to inspect the active PR and add
a missing Cooee label without replacing existing labels. It adds a clear
customer-facing category (`cooee:feature`, `cooee:improvement`, `cooee:fix`, or
`cooee:maintenance`) and asks before applying a privacy label. The defaults are
`cooee:skip` and `cooee:internal`; use `cooee:private` only after adding it to
Cooee's Privacy labels settings. See [Coding-agent PR labels](agent-skills.md)
for the full workflow and custom-category behavior.

## Service configuration

### Cooee

Use `railway.json`. It builds every workspace, applies database migrations
before startup, starts `@cooee/api`, and checks `/api/ready`.

Generate a public Railway domain, then set `APP_URL` and `BETTER_AUTH_URL` to
that HTTPS origin. The same origin serves `/`, `/changelog`, `/docs`, `/changelog/*`,
and `/api/*`.

### Cron

Use `railway.cron.json`. Give it the same database, GitHub, OpenAI, auth, and
generation variables as the Cooee service. It runs every 15 minutes in UTC and
does not need a public domain.

### MCP

Use `railway.mcp.json` and set:

```dotenv
COOEE_API_BASE_URL=https://changelog.example.com
MCP_URL=https://YOUR_MCP_DOMAIN
HOST=0.0.0.0
```

Attach a public domain and verify `/health` and `/mcp`. The MCP service is
read-only, exposes only `get-changelog-updates`, and never accepts a caller-
supplied API origin.

## Optional integrations

### Object storage

Without object storage, generated and uploaded changelog images are not
available. Cooee supports S3-compatible storage. On Railway, attach a private
bucket and reference its `BUCKET`, `ENDPOINT`, `ACCESS_KEY_ID`,
`SECRET_ACCESS_KEY`, and `REGION` variables from the Cooee and cron services.
Keep the bucket private; Cooee serves validated public assets through its API.

### Custom changelog domains

Custom-domain automation requires a Cloudflare zone and an API token scoped to
that zone. Set `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, and
`CLOUDFLARE_CUSTOM_HOSTNAME_CNAME_TARGET`. The target must be a proxied hostname
that routes to the Cooee API service. If you do not offer custom domains, leave
these values unset.

### Billing and email

Self-hosted deployments should leave `BILLING_ENABLED=false` and
`VITE_BILLING_ENABLED=false`. Enabling hosted billing additionally requires a
correct Stripe catalog, signed billing webhooks, transactional email, metering,
and operational reconciliation. The public template does not configure those
systems.

### Analytics

Analytics are disabled when `VITE_POSTHOG_KEY` is absent. If enabled, update
your privacy notice and consent behavior for the jurisdictions in which you
operate.

## First deployment

1. Deploy PostgreSQL and the Cooee service with all required variables.
2. Generate the Cooee public domain and set `APP_URL` and `BETTER_AUTH_URL`.
3. Configure the GitHub OAuth and GitHub App URLs for that domain.
4. Redeploy and verify `GET /api/health` and `GET /api/ready` return `200`.
5. Sign in, install the GitHub App on a test repository, and publish a safe test
   changelog entry.
6. Start the cron service and verify its next scheduled run.
7. If deployed, verify the MCP service health, tool listing, and one valid tool
   call.

## Upgrades and backups

Deploy from a reviewed release or commit through the GitHub integration. The
Cooee and cron services both run the checksum-validated migrator. Migrations are
designed to be repeatable, but you must still take and test backups before an
upgrade.

- Schedule PostgreSQL backups and rehearse an isolated restore.
- Back up object storage separately when enabled.
- Run `bun run migrate` against a production-shaped staging database first.
- Prefer a corrective forward migration over rolling code back across an
  incompatible schema.
- Keep `BETTER_AUTH_SECRET`, GitHub credentials, and encrypted data keys stable
  across ordinary releases.

## Verification

From a signed-out client, verify:

```bash
curl --fail https://changelog.example.com/api/health
curl --fail https://changelog.example.com/api/ready
curl --fail https://changelog.example.com/api/public/openapi.json
```

Also verify that admin endpoints reject signed-out requests, webhook signatures
fail closed, unpublished entries never appear in public feeds, and a public
feed can be loaded from a different browser origin.

For security reports and supported versions, see [SECURITY.md](../SECURITY.md).
