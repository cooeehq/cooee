import { createCooeeMcpServer } from "./server";

const production = process.env.NODE_ENV === "production";
const apiBaseUrl =
  process.env.COOEE_API_BASE_URL ?? (production ? "" : "http://localhost:3000");
const mcpUrl =
  process.env.MCP_URL ?? (production ? "" : "http://localhost:3001");

if (!apiBaseUrl || !mcpUrl) {
  throw new Error("COOEE_API_BASE_URL and MCP_URL are required in production.");
}

const server = createCooeeMcpServer({ apiBaseUrl, mcpUrl });
const port = Number(process.env.PORT ?? 3001);

console.log(`Cooee MCP listening on port ${port}`);
server.listen(port);
