# Cooee MCP

Read-only MCP server for published Cooee changelogs. It exposes one tool,
`get-changelog-updates`, backed by Cooee's public API. It cannot create, edit,
publish, or delete changelog content.

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
```

## Production

Deploy this workspace as a separate GitHub-integrated Railway service using
`railway.mcp.json`. Set:

```bash
COOEE_API_BASE_URL=https://api.cooee.sh
MCP_URL=https://mcp.cooee.sh
HOST=0.0.0.0
```

For self-hosting, replace both origins with the public Railway domains assigned
to your Cooee and MCP services. `COOEE_API_BASE_URL` is fixed by the operator;
tool callers cannot provide an alternate upstream origin.

The service intentionally has no `railway up` release path. Production uses
the GitHub integration and `railway.mcp.json`, which builds the MCP workspace,
starts the generated server, and checks `/health`.
