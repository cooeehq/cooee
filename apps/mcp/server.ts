import { publicFeedSchema } from "../../packages/shared/src/public-api";
import { MCPServer, error, object, oauthCustomProvider } from "mcp-use/server";
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

export const workspaceInputSchema = z.object({
  workspaceId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional Cooee workspace ID; omit it to return pending posts from every accessible workspace",
    ),
});

export const pendingPostInputSchema = z.object({
  workspaceId: z
    .string()
    .min(1)
    .describe("Workspace ID returned by list-pending-posts"),
  postId: z
    .string()
    .min(1)
    .describe("Pending post ID returned by list-pending-posts"),
});

export const updatePendingPostInputSchema = pendingPostInputSchema.extend({
  title: z.string().min(1).max(200).describe("Reviewed customer-facing title"),
  summary: z
    .string()
    .min(1)
    .max(10_000)
    .describe("Reviewed customer-facing summary"),
  category: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .describe(
      "Reviewed changelog category ID; keep the current ID unless the user asks to change it",
    ),
});

export const publishPendingPostInputSchema = pendingPostInputSchema.extend({
  title: z
    .string()
    .min(1)
    .max(200)
    .describe("The exact final title the user confirmed"),
  summary: z
    .string()
    .min(1)
    .max(10_000)
    .describe("The exact final summary the user confirmed"),
  category: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .describe("The exact final category ID the user confirmed"),
  confirmed: z
    .literal(true)
    .describe(
      "Must be true only after the user has reviewed the final title, summary, and category and explicitly asked to publish",
    ),
});

export function createCooeeMcpServer({
  apiBaseUrl,
  fetchImpl = fetch,
  mcpUrl,
}: CreateCooeeMcpServerOptions): MCPServer {
  const apiOrigin = normalizeHttpOrigin(apiBaseUrl);
  const authBaseUrl = new URL("/api/auth", apiOrigin)
    .toString()
    .replace(/\/$/, "");
  const server = new MCPServer({
    name: "cooee",
    title: "Cooee",
    version: "0.1.0",
    description:
      "Read published Cooee updates and review pending changelog posts with an authenticated Cooee account.",
    instructions:
      "Use list-pending-posts to find drafts waiting for review. Show the user the complete final title, summary, and category before publishing. Use update-pending-post to make requested edits. Never call publish-pending-post until the user explicitly confirms that exact final post.",
    baseUrl: mcpUrl,
    oauth: oauthCustomProvider({
      issuer: apiOrigin.origin,
      authEndpoint: `${authBaseUrl}/mcp/authorize`,
      tokenEndpoint: `${authBaseUrl}/mcp/token`,
      scopesSupported: [
        "openid",
        "profile",
        "email",
        "offline_access",
        "cooee:review",
      ],
      grantTypesSupported: ["authorization_code", "refresh_token"],
      verifyToken: async (token) => {
        const response = await fetchImpl(`${authBaseUrl}/mcp/get-session`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Cooee authentication failed.");
        const session = (await response.json()) as {
          userId?: unknown;
          scopes?: unknown;
        } | null;
        if (!session || typeof session.userId !== "string") {
          throw new Error("Cooee authentication failed.");
        }
        return {
          payload: {
            sub: session.userId,
            scope: typeof session.scopes === "string" ? session.scopes : "",
          },
        };
      },
      getUserInfo: (payload) => ({ userId: String(payload.sub ?? "") }),
    }),
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

  server.tool(
    {
      name: "list-pending-posts",
      description:
        "List complete unpublished Cooee changelog posts that are waiting for the authenticated user to review",
      schema: workspaceInputSchema,
      annotations: {
        destructiveHint: false,
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId }, context) => {
      const endpoint = new URL("/api/mcp/pending-posts", apiOrigin);
      if (workspaceId) endpoint.searchParams.set("workspaceId", workspaceId);
      return fetchAuthenticatedApi({ endpoint, fetchImpl, context });
    },
  );

  server.tool(
    {
      name: "update-pending-post",
      description:
        "Edit the title, summary, and category of one unpublished Cooee post while keeping it pending for review",
      schema: updatePendingPostInputSchema,
      annotations: {
        destructiveHint: false,
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, postId, title, summary, category }, context) => {
      const endpoint = pendingPostEndpoint(apiOrigin, workspaceId, postId);
      return fetchAuthenticatedApi({
        endpoint,
        fetchImpl,
        context,
        method: "PUT",
        body: { title, summary, category },
      });
    },
  );

  server.tool(
    {
      name: "publish-pending-post",
      description:
        "Publish one reviewed Cooee post only after the user explicitly confirms the exact final title, summary, and category in the current conversation",
      schema: publishPendingPostInputSchema,
      annotations: {
        destructiveHint: true,
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async (
      { workspaceId, postId, title, summary, category, confirmed },
      context,
    ) => {
      const endpoint = pendingPostEndpoint(apiOrigin, workspaceId, postId);
      return fetchAuthenticatedApi({
        endpoint,
        fetchImpl,
        context,
        method: "POST",
        body: { confirm: confirmed, title, summary, category },
      });
    },
  );

  return server;
}

function pendingPostEndpoint(
  apiOrigin: URL,
  workspaceId: string,
  postId: string,
) {
  const endpoint = new URL(
    `/api/mcp/pending-posts/${encodeURIComponent(postId)}`,
    apiOrigin,
  );
  endpoint.searchParams.set("workspaceId", workspaceId);
  return endpoint;
}

async function fetchAuthenticatedApi({
  body,
  context,
  endpoint,
  fetchImpl,
  method = "GET",
}: {
  body?: Record<string, unknown>;
  context: { auth?: { accessToken: string } };
  endpoint: URL;
  fetchImpl: typeof fetch;
  method?: "GET" | "POST" | "PUT";
}) {
  if (!context.auth?.accessToken) return error("Authentication required.");
  try {
    const response = await fetchImpl(endpoint, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${context.auth.accessToken}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!response.ok) {
      return error(
        typeof payload?.error === "string"
          ? payload.error
          : "Cooee could not complete that review action.",
      );
    }
    return object(payload ?? {});
  } catch {
    return error("Cooee could not be reached. Please try again.");
  }
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
