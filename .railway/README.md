# Railway infrastructure

`railway.ts` is the source of truth for a self-hosted Cooee project. It defines
PostgreSQL, the combined application/API, the scheduled worker, and the
read-only MCP service.

From a Railway-linked checkout, review changes before applying them:

```bash
railway config plan
railway config apply
```

The public Railway template contains the same service commands and variables.
Keep both definitions aligned when changing a service build, start command,
health check, schedule, or required variable.
