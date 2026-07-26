import { z } from "zod";

export const publicChangelogCategoryDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  displayType: z.enum(["post", "callout", "text"]),
  marketingCopy: z.boolean().optional(),
});

export const publicChangelogChangeItemSchema = z.object({
  title: z.string(),
  summary: z.string(),
  category: z.string(),
});

export const publicFeedEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  category: z.string(),
  publishedAt: z.string(),
  imageUrl: z.string().nullable().optional(),
  items: z.array(publicChangelogChangeItemSchema).optional(),
  sourcePullRequests: z
    .array(
      z.object({
        number: z.number(),
        title: z.string().optional(),
        url: z.string(),
      }),
    )
    .optional(),
});

export const publicFeedPaginationSchema = z.object({
  hasMore: z.boolean(),
  nextBefore: z.string().nullable(),
  windowStartedAt: z.string().nullable(),
  windowEndedAt: z.string().nullable(),
});

export const publicChangelogSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  publicUrl: z.string(),
  logoUrl: z.string().nullable().optional(),
  lightLogoUrl: z.string().nullable().optional(),
  faviconUrl: z.string().nullable().optional(),
  publicTheme: z.enum(["light", "dark"]).optional(),
  publicLogoAlignment: z.enum(["left", "center", "right"]).optional(),
  publicAppUrl: z.string().nullable().optional(),
  publicAppLabel: z.string().nullable().optional(),
  categoryDefinitions: z
    .array(publicChangelogCategoryDefinitionSchema)
    .optional(),
  groupEntriesByCategory: z.boolean().optional(),
});

export const publicFeedSchema = z.object({
  changelog: publicChangelogSchema,
  generatedAt: z.string(),
  entries: z.array(publicFeedEntrySchema),
  groups: z.record(z.string(), z.array(publicFeedEntrySchema)),
  pagination: publicFeedPaginationSchema.optional(),
});

const publicFeedBeforeSchema = z.iso.datetime({ offset: true });
const publicFeedLimitSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(20));

export type PublicFeedQuery = {
  before: string | null;
  limit: number;
};

export type PublicFeedQueryResult =
  | { success: true; data: PublicFeedQuery }
  | { success: false; error: string };

export function parsePublicFeedQuery(
  searchParams: URLSearchParams,
  options: { includeLimit?: boolean } = {},
): PublicFeedQueryResult {
  const before = searchParams.get("before");
  if (before && !publicFeedBeforeSchema.safeParse(before).success) {
    return {
      success: false,
      error: "before must be an RFC 3339 timestamp.",
    };
  }

  const limitValue = searchParams.get("limit");
  if (options.includeLimit && limitValue !== null) {
    const limit = publicFeedLimitSchema.safeParse(limitValue);
    if (!limit.success) {
      return {
        success: false,
        error: "limit must be a whole number from 1 to 20.",
      };
    }

    return { success: true, data: { before, limit: limit.data } };
  }

  return { success: true, data: { before, limit: 5 } };
}

const publicFeedExample = {
  changelog: {
    slug: "acme-app",
    name: "Acme App",
    description: "Latest product updates",
    publicUrl: "https://cooee.sh/changelog/acme-app",
  },
  generatedAt: "2026-07-22T08:30:00.000Z",
  entries: [
    {
      id: "update_123",
      title: "Faster search",
      summary: "Search results now arrive sooner.",
      category: "improvement",
      publishedAt: "2026-07-22T08:00:00.000Z",
      imageUrl: "https://cooee.sh/api/public/assets/update_123.png",
    },
  ],
  groups: {},
  pagination: {
    hasMore: false,
    nextBefore: null,
    windowStartedAt: "2026-07-15T08:00:00.000Z",
    windowEndedAt: "2026-07-22T08:00:00.000Z",
  },
} as const;

export const publicApiOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Cooee Public API",
    version: "1.0.0",
    description: "Read published Cooee changelogs without authentication.",
  },
  servers: [{ url: "https://cooee.sh" }],
  paths: {
    "/api/public/changelogs/{slug}/feed.json": {
      get: {
        operationId: "getChangelogFeed",
        summary: "Get a published changelog feed window",
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            schema: { type: "string", example: "acme-app" },
          },
          {
            name: "before",
            in: "query",
            required: false,
            schema: {
              type: "string",
              format: "date-time",
              example: "2026-07-15T08:00:00Z",
            },
          },
        ],
        responses: {
          "200": {
            description: "Published changelog feed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PublicFeed" },
                example: publicFeedExample,
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      head: {
        operationId: "headChangelogFeed",
        summary: "Check whether a public changelog feed is available",
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            schema: { type: "string", example: "acme-app" },
          },
        ],
        responses: {
          "200": { description: "The feed is available" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/public/changelogs/{slug}/feed.xml": {
      get: {
        operationId: "getChangelogRssFeed",
        summary: "Get a published changelog RSS feed",
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            schema: { type: "string", example: "acme-app" },
          },
          {
            name: "before",
            in: "query",
            required: false,
            schema: {
              type: "string",
              format: "date-time",
              example: "2026-07-15T08:00:00Z",
            },
          },
        ],
        responses: {
          "200": {
            description: "Published changelog RSS feed",
            content: {
              "application/rss+xml": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      head: {
        operationId: "headChangelogRssFeed",
        summary: "Check whether a public changelog RSS feed is available",
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            schema: { type: "string", example: "acme-app" },
          },
        ],
        responses: {
          "200": { description: "The RSS feed is available" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/public/changelogs/{slug}/latest": {
      get: {
        operationId: "getLatestChangelogUpdates",
        summary: "Get the latest published changelog updates",
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            schema: { type: "string", example: "acme-app" },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 20,
              default: 5,
              example: 5,
            },
          },
          {
            name: "before",
            in: "query",
            required: false,
            schema: {
              type: "string",
              format: "date-time",
              example: "2026-07-15T08:00:00Z",
            },
          },
        ],
        responses: {
          "200": {
            description: "Latest published changelog updates",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PublicFeed" },
                example: publicFeedExample,
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      head: {
        operationId: "headLatestChangelogUpdates",
        summary: "Check whether latest public updates are available",
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            schema: { type: "string", example: "acme-app" },
          },
        ],
        responses: {
          "200": { description: "Latest updates are available" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
  },
  components: {
    responses: {
      InvalidRequest: {
        description: "The query parameters are invalid",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      NotFound: {
        description: "The changelog does not exist or is not public",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "string",
            example: "limit must be a whole number from 1 to 20.",
          },
        },
      },
      PublicFeed: {
        type: "object",
        required: ["changelog", "generatedAt", "entries", "groups"],
        properties: {
          changelog: {
            type: "object",
            required: ["slug", "name", "description", "publicUrl"],
            properties: {
              slug: { type: "string" },
              name: { type: "string" },
              description: { type: ["string", "null"] },
              publicUrl: { type: "string", format: "uri" },
              logoUrl: { type: ["string", "null"], format: "uri" },
              lightLogoUrl: { type: ["string", "null"], format: "uri" },
              faviconUrl: { type: ["string", "null"], format: "uri" },
              publicTheme: { type: "string", enum: ["light", "dark"] },
              publicLogoAlignment: {
                type: "string",
                enum: ["left", "center", "right"],
              },
              publicAppUrl: { type: ["string", "null"] },
              publicAppLabel: { type: ["string", "null"] },
              categoryDefinitions: {
                type: "array",
                items: { $ref: "#/components/schemas/CategoryDefinition" },
              },
              groupEntriesByCategory: { type: "boolean" },
            },
          },
          generatedAt: { type: "string", format: "date-time" },
          entries: {
            type: "array",
            items: { $ref: "#/components/schemas/FeedEntry" },
          },
          groups: {
            type: "object",
            additionalProperties: {
              type: "array",
              items: { $ref: "#/components/schemas/FeedEntry" },
            },
          },
          pagination: { $ref: "#/components/schemas/Pagination" },
        },
      },
      FeedEntry: {
        type: "object",
        required: ["id", "title", "summary", "category", "publishedAt"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          category: { type: "string" },
          publishedAt: { type: "string", format: "date-time" },
          imageUrl: { type: ["string", "null"], format: "uri" },
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/ChangeItem" },
          },
          sourcePullRequests: {
            type: "array",
            items: {
              type: "object",
              required: ["number", "url"],
              properties: {
                number: { type: "integer" },
                title: { type: "string" },
                url: { type: "string", format: "uri" },
              },
            },
          },
        },
      },
      ChangeItem: {
        type: "object",
        required: ["title", "summary", "category"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          category: { type: "string" },
        },
      },
      CategoryDefinition: {
        type: "object",
        required: ["id", "label", "displayType"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          displayType: { type: "string", enum: ["post", "callout", "text"] },
          marketingCopy: { type: "boolean" },
        },
      },
      Pagination: {
        type: "object",
        required: ["hasMore", "nextBefore", "windowStartedAt", "windowEndedAt"],
        properties: {
          hasMore: { type: "boolean" },
          nextBefore: { type: ["string", "null"], format: "date-time" },
          windowStartedAt: { type: ["string", "null"], format: "date-time" },
          windowEndedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
    },
  },
} as const;
