import { describe, expect, test } from "bun:test";
import {
  createCooeeMcpServer,
  fetchPublicChangelogUpdates,
  getChangelogUpdatesInputSchema,
} from "./server";

const validFeed = {
  changelog: {
    slug: "acme-app",
    name: "Acme App",
    description: "Latest product updates",
    publicUrl: "https://cooee.test/changelog/acme-app",
  },
  generatedAt: "2026-07-21T12:00:00.000Z",
  entries: [
    {
      id: "entry-1",
      title: "Faster search",
      summary: "Search results now arrive sooner.",
      category: "improvement",
      publishedAt: "2026-07-21T10:00:00.000Z",
    },
  ],
  groups: {
    improvement: [
      {
        id: "entry-1",
        title: "Faster search",
        summary: "Search results now arrive sooner.",
        category: "improvement",
        publishedAt: "2026-07-21T10:00:00.000Z",
      },
    ],
  },
  pagination: {
    hasMore: true,
    nextBefore: "2026-07-14T10:00:00.000Z",
    windowStartedAt: "2026-07-14T10:00:00.000Z",
    windowEndedAt: "2026-07-21T10:00:00.000Z",
  },
};

describe("Cooee MCP", () => {
  test("registers one read-only tool and serves health", async () => {
    const server = createCooeeMcpServer({
      apiBaseUrl: "https://cooee.test",
      mcpUrl: "https://mcp.cooee.test",
    });

    expect(server.registeredTools).toEqual(["get-changelog-updates"]);
    const health = await server.app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, service: "cooee-mcp" });
  });

  test("validates tool inputs", () => {
    expect(
      getChangelogUpdatesInputSchema.safeParse({
        slug: "acme-app",
        limit: 20,
        before: "2026-07-14T10:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      getChangelogUpdatesInputSchema.safeParse({
        slug: "https://evil.test/feed",
        limit: 21,
      }).success,
    ).toBe(false);
  });

  test("fetches only from the configured API origin", async () => {
    let requestedUrl = "";
    const result = await fetchPublicChangelogUpdates({
      apiOrigin: new URL("https://cooee.test"),
      before: "2026-07-14T10:00:00.000Z",
      fetchImpl: (async (input) => {
        requestedUrl = String(input);
        return Response.json(validFeed);
      }) as typeof fetch,
      limit: 10,
      slug: "acme-app",
    });

    expect(result).toEqual({ success: true, feed: validFeed });
    expect(requestedUrl).toBe(
      "https://cooee.test/api/public/changelogs/acme-app/latest?limit=10&before=2026-07-14T10%3A00%3A00.000Z",
    );
  });

  test("returns useful safe errors for upstream failures", async () => {
    for (const [status, message] of [
      [404, "not found or is not public"],
      [429, "too many requests"],
      [503, "could not load"],
    ] as const) {
      const result = await fetchPublicChangelogUpdates({
        apiOrigin: new URL("https://cooee.test"),
        fetchImpl: (async () => new Response(null, { status })) as typeof fetch,
        limit: 5,
        slug: "acme-app",
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toContain(message);
    }

    const malformed = await fetchPublicChangelogUpdates({
      apiOrigin: new URL("https://cooee.test"),
      fetchImpl: (async () => Response.json({ entries: [] })) as typeof fetch,
      limit: 5,
      slug: "acme-app",
    });
    expect(malformed).toMatchObject({
      success: false,
      message: expect.stringContaining("unexpected feed response"),
    });
  });

  test("rejects a non-HTTP API base URL", () => {
    expect(() =>
      createCooeeMcpServer({
        apiBaseUrl: "file:///tmp/cooee",
        mcpUrl: "https://mcp.cooee.test",
      }),
    ).toThrow("must use HTTP or HTTPS");
  });
});
