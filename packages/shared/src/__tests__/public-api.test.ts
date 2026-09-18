import { describe, expect, test } from "bun:test";
import { parsePublicFeedQuery, publicFeedSchema } from "../public-api";

describe("public API contract", () => {
  test("parses documented feed query parameters", () => {
    expect(
      parsePublicFeedQuery(
        new URLSearchParams({
          before: "2026-07-21T12:30:00.000Z",
          limit: "12",
        }),
        { includeLimit: true },
      ),
    ).toEqual({
      success: true,
      data: { before: "2026-07-21T12:30:00.000Z", limit: 12 },
    });
  });

  test("rejects malformed cursors and limits", () => {
    expect(
      parsePublicFeedQuery(new URLSearchParams({ before: "last-week" })),
    ).toMatchObject({ success: false });
    expect(
      parsePublicFeedQuery(new URLSearchParams({ limit: "21" }), {
        includeLimit: true,
      }),
    ).toMatchObject({ success: false });
  });

  test("validates the public feed wire shape", () => {
    expect(
      publicFeedSchema.safeParse({
        changelog: {
          slug: "cooee",
          name: "Cooee",
          description: null,
          publicUrl: "https://cooee.sh/changelog/cooee",
        },
        generatedAt: "2026-07-21T12:30:00.000Z",
        entries: [],
        groups: {},
        pagination: {
          hasMore: false,
          nextBefore: null,
          windowStartedAt: null,
          windowEndedAt: null,
        },
      }).success,
    ).toBe(true);
  });
});
