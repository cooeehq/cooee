import { createApp } from "./server";
import { validateProductionConfig } from "./config";
import { resolveStaticRoot } from "./static-root";

const port = Number(Bun.env.PORT ?? 3000);
validateProductionConfig();
const app = createApp({
  staticRoot: resolveStaticRoot(Bun.env.COOEE_STATIC_ROOT, import.meta.dir),
});

const server = Bun.serve({
  port,
  maxRequestBodySize: 4 * 1024 * 1024,
  fetch: app.fetch,
});

server.ref();

console.log(`Cooee API listening on ${server.url}`);
