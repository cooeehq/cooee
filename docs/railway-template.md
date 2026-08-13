# Deploy and Host Cooee with Railway

Cooee turns merged GitHub pull requests into a privacy-first product
changelog. This template deploys the complete self-hosted stack: the web app,
operator dashboard, public API, scheduled worker, PostgreSQL, and the optional
read-only MCP service.

## About Hosting Cooee

Hosting Cooee gives your team its own changelog pipeline and data store. GitHub
supplies pull-request metadata, Cooee drafts and reviews customer-facing
updates, and your public feed, React embed, and MCP clients read only entries
you have published.

The default deployment uses one public Cooee origin for the website, dashboard,
public changelogs, docs, and API. A private worker handles scheduled jobs, while
MCP runs as a separate read-only public service.

## Why Deploy Cooee on Railway

Railway can provision the app, worker, MCP server, database, private networking,
public domains, health checks, generated secrets, and persistent storage in one
project. The template keeps configuration explicit while removing repetitive
service wiring.

GitHub-integrated deployments also make upgrades reviewable: merge a tested
release and let Railway rebuild the affected services from the repository.

## Common Use Cases

- Turn merged pull requests into reviewed product updates.
- Let coding agents classify the pull requests they create before merge.
- Publish a hosted changelog and cross-origin JSON feed.
- Add an accessible updates popup to a React 18 or 19 application.
- Let AI clients retrieve published updates through a read-only MCP tool.
- Run a private, self-hosted Cooee instance without managed billing.

## Dependencies for Cooee

### Deployment Dependencies

- A Railway account and workspace.
- A GitHub OAuth app for user sign-in.
- A GitHub App with read-only pull-request, contents, and metadata access.
- An OpenAI API key for changelog drafting.
- The public Cooee repository, once released, for GitHub-integrated builds.

PostgreSQL is included in this template. No separate database account is
required.

### Services

- **Cooee** serves the operator dashboard, public changelogs, and API from one
  public origin. The managed marketing website and docs are not part of the
  template.
- **Cron** processes scheduled changelog generation every 15 minutes.
- **Postgres** stores application data on a persistent Railway volume.
- **MCP** exposes the read-only `get-changelog-updates` tool at `/mcp`.

Railway generates the database password, Better Auth secret, and GitHub webhook
secret. Service URLs and database connections use Railway reference variables,
so they stay inside the deployed project.

### Required Inputs

Create a GitHub OAuth app and GitHub App before deploying, then provide:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY`
- `OPENAI_API_KEY`

The GitHub App needs read-only access to pull requests and metadata, and should
subscribe to pull request, installation, and installation-repository events.

To label PRs from Codex, Claude, or another compatible coding agent, install
the Cooee PR Labels skill in each developer environment. It uses the
developer's GitHub CLI permission to add labels, so the Cooee GitHub App stays
read-only. See [Coding-agent PR labels](https://github.com/cooeehq/cooee/blob/main/docs/agent-skills.md).

## After Deployment

Use the generated Cooee HTTPS domain for the GitHub integration URLs:

```text
OAuth callback:      https://YOUR_DOMAIN/api/auth/callback/github
GitHub App callback: https://YOUR_DOMAIN/api/github/callback
GitHub App webhook:  https://YOUR_DOMAIN/api/webhooks/github
```

Confirm `APP_URL` and `BETTER_AUTH_URL` use the same domain, then redeploy Cooee
and Cron. Verify:

```bash
curl --fail https://YOUR_DOMAIN/api/health
curl --fail https://YOUR_DOMAIN/api/ready
curl --fail https://YOUR_DOMAIN/api/public/openapi.json
curl --fail https://YOUR_MCP_DOMAIN/health
```

Billing, Cloudflare custom-domain automation, email, analytics, and object
storage are disabled or omitted by default. Add only the optional integrations
you intend to operate.

For the complete environment reference, backup guidance, upgrades, and smoke
tests, read the [self-hosting guide](https://github.com/cooeehq/cooee/blob/main/docs/self-hosting.md).

## Support

- [Documentation](https://cooee.sh/docs)
- [Source and issues](https://github.com/cooeehq/cooee)
- [Security policy](https://github.com/cooeehq/cooee/blob/main/SECURITY.md)
