import { publicFeedSchema } from "../../packages/shared/src/public-api";
import { MCPServer, error, object } from "mcp-use/server";
import { z } from "zod";

type CreateCooeeMcpServerOptions = {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  mcpUrl: string;
};

export const getChangelogUpdatesInputSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .describe("Public Cooee changelog slug, such as 'acme-app'"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Maximum updates to return, from 1 to 20; defaults to 5"),
  before: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("RFC 3339 cursor from pagination.nextBefore for older updates"),
});

export function createCooeeMcpServer({
  apiBaseUrl,
  fetchImpl = fetch,
  mcpUrl,
}: CreateCooeeMcpServerOptions): MCPServer {
  const apiOrigin = normalizeHttpOrigin(apiBaseUrl);
  const server = new MCPServer({
    name: "cooee",
    title: "Cooee",
    version: "0.1.0",
    description: "Read published product updates from Cooee changelogs.",
    baseUrl: mcpUrl,
    favicon: "icon.svg",
    websiteUrl: "https://cooee.sh/docs#mcp",
    icons: [
      {
        src: "icon.svg",
        mimeType: "image/svg+xml",
        sizes: ["512x512"],
      },
    ],
  });

  server.app.get("/health", (context) =>
    context.json({ ok: true, service: "cooee-mcp" }),
  );

  server.tool(
    {
      name: "get-changelog-updates",
      description:
        "Get published updates and pagination metadata for a public Cooee changelog",
      schema: getChangelogUpdatesInputSchema,
      outputSchema: publicFeedSchema,
      annotations: {
        destructiveHint: false,
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ slug, limit = 5, before }) => {
      const result = await fetchPublicChangelogUpdates({
        apiOrigin,
        before,
        fetchImpl,
        limit,
        slug,
      });

      return result.success ? object(result.feed) : error(result.message);
    },
  );

  return server;
}

export async function fetchPublicChangelogUpdates({
  apiOrigin,
  before,
  fetchImpl,
  limit,
  slug,
}: {
  apiOrigin: URL;
  before?: string;
  fetchImpl: typeof fetch;
  limit: number;
  slug: string;
}): Promise<
  | { success: true; feed: z.infer<typeof publicFeedSchema> }
  | { success: false; message: string }
> {
  const endpoint = new URL(
    `/api/public/changelogs/${encodeURIComponent(slug)}/latest`,
    apiOrigin,
  );
  endpoint.searchParams.set("limit", String(limit));
  if (before) endpoint.searchParams.set("before", before);

  try {
    const response = await fetchImpl(endpoint, {
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) {
      return {
        success: false,
        message: "That changelog was not found or is not public.",
      };
    }
    if (response.status === 429) {
      return {
        success: false,
        message:
          "Cooee is receiving too many requests. Please try again shortly.",
      };
    }
    if (!response.ok) {
      return {
        success: false,
        message: "Cooee could not load that changelog. Please try again.",
      };
    }

    const parsed = publicFeedSchema.safeParse(await response.json());
    if (!parsed.success) {
      return {
        success: false,
        message:
          "Cooee returned an unexpected feed response. Please try again.",
      };
    }

    return { success: true, feed: parsed.data };
  } catch {
    return {
      success: false,
      message: "Cooee could not be reached. Please try again.",
    };
  }
}

function normalizeHttpOrigin(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("COOEE_API_BASE_URL must use HTTP or HTTPS.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}
