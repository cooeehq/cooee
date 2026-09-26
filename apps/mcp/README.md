# Cooee MCP

OAuth-protected MCP server for Cooee changelogs. It can read published updates,
list posts waiting for review, edit a pending post, and publish only after the
user explicitly confirms the final copy in the current conversation.

Pending posts have passed Cooee's publication guardrails and are waiting only
because automatic publishing is off. Guardrail-held drafts are deliberately not
returned by the pending-post tools.

The tools are `get-changelog-updates`, `list-pending-posts`,
`update-pending-post`, and `publish-pending-post`.

## Local development

From the repository root:

```bash
bun install
COOEE_API_BASE_URL=http://localhost:3000 \
MCP_URL=http://localhost:3001 \
bun run --cwd apps/mcp dev
```

The MCP endpoint is `http://localhost:3001/mcp` and the health endpoint is
`http://localhost:3001/health`.

```bash
npx mcp-use client connect cooee-local http://localhost:3001/mcp
npx mcp-use client cooee-local tools list
npx mcp-use client cooee-local tools call get-changelog-updates slug=acme-app limit=5
npx mcp-use client cooee-local tools call list-pending-posts
```

## Production

Deploy this workspace as the separate GitHub-integrated MCP service defined in
the root [Railway infrastructure](../../.railway/railway.ts). Set:

```bash
COOEE_API_BASE_URL=https://api.cooee.sh
MCP_URL=https://mcp.cooee.sh
HOST=0.0.0.0
```

For self-hosting, replace both origins with the public Railway domains assigned
to your Cooee and MCP services. `COOEE_API_BASE_URL` is fixed by the operator;
tool callers cannot provide an alternate upstream origin.

OAuth discovery is exposed by the MCP service and delegates sign-in and token
issuance to the Cooee API's Better Auth instance.

The service intentionally has no `railway up` release path. Production uses
the GitHub integration and the project-level Railway definition, which builds
the MCP workspace, starts the generated server, and checks `/health`.
