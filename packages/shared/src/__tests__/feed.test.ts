import { describe, expect, test } from "bun:test";
import { serializePublicFeed } from "../feed";

describe("public feed serialization", () => {
  test("groups published entries and excludes private fields by default", () => {
    const feed = serializePublicFeed({
      changelog: {
        slug: "acme-app",
        name: "Acme App",
        description: "Latest product updates",
        publicUrl: "https://cooee.example.com/acme-app"
      },
      entries: [
        {
          id: "entry_1",
          title: "Saved filters",
          summary: "You can now save filters and reuse them later.",
          category: "feature",
          status: "published",
          publishedAt: "2026-06-05T23:00:00.000Z",
          items: [
            {
              title: "Saved filters",
              summary: "Users can save filter views and return to them later.",
              category: "feature"
            },
            {
              title: "Login recovery",
              summary: "Expired sessions now recover without interrupting work.",
              category: "fix"
            }
          ],
          sourcePullRequests: [{ number: 42, url: "https://github.com/acme/app/pull/42", author: "octocat" }]
        },
        {
          id: "entry_2",
          title: "Internal refactor",
          summary: "Held entry",
          category: "maintenance",
          status: "held",
          publishedAt: null,
          sourcePullRequests: []
        }
      ],
      includePullRequestLinks: false
    });

    expect(feed.changelog.publicTheme).toBe("light");
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]?.items).toEqual([
      {
        title: "Saved filters",
        summary: "Users can save filter views and return to them later.",
        category: "feature"
      },
      {
        title: "Login recovery",
        summary: "Expired sessions now recover without interrupting work.",
        category: "fix"
      }
    ]);
    expect(feed.entries[0]?.sourcePullRequests).toBeUndefined();
    expect(feed.groups.feature).toHaveLength(1);
    expect(feed.groups.maintenance).toHaveLength(0);
  });

  test("sorts same-date entries and nested items by category priority", () => {
    const feed = serializePublicFeed({
      changelog: {
        slug: "acme-app",
        name: "Acme App",
        description: "Latest product updates",
        publicUrl: "https://cooee.example.com/acme-app"
      },
      entries: [
        {
          id: "entry_maintenance",
          title: "Maintenance update",
          summary: "Maintenance details.",
          category: "maintenance",
          status: "published",
          publishedAt: "2026-06-05T23:00:00.000Z",
          sourcePullRequests: []
        },
        {
          id: "entry_fix",
          title: "Fix update",
          summary: "Fix details.",
          category: "fix",
          status: "published",
          publishedAt: "2026-06-05T23:00:00.000Z",
          sourcePullRequests: []
        },
        {
          id: "entry_feature",
          title: "Feature update",
          summary: "Feature details.",
          category: "feature",
          status: "published",
          publishedAt: "2026-06-05T23:00:00.000Z",
          items: [
            {
              title: "Maintenance item",
              summary: "Maintenance details.",
              category: "maintenance"
            },
            {
              title: "Feature item",
              summary: "Feature details.",
              category: "feature"
            },
            {
              title: "Fix item",
              summary: "Fix details.",
              category: "fix"
            },
            {
              title: "Improvement item",
              summary: "Improvement details.",
              category: "improvement"
            }
          ],
          sourcePullRequests: []
        },
        {
          id: "entry_improvement",
          title: "Improvement update",
          summary: "Improvement details.",
          category: "improvement",
          status: "published",
          publishedAt: "2026-06-05T23:00:00.000Z",
          sourcePullRequests: []
        }
      ],
      includePullRequestLinks: false
    });

    expect(feed.entries.map((entry) => entry.id)).toEqual([
      "entry_feature",
      "entry_improvement",
      "entry_fix",
      "entry_maintenance"
    ]);
    expect(feed.entries[0]?.items?.map((item) => item.category)).toEqual([
      "feature",
      "improvement",
      "fix",
      "maintenance"
    ]);
  });

  test("includes a configured public changelog theme", () => {
    const feed = serializePublicFeed({
      changelog: {
        slug: "acme-app",
        name: "Acme App",
        description: "Latest product updates",
        publicUrl: "https://cooee.example.com/acme-app",
        publicTheme: "dark"
      },
      entries: [],
      includePullRequestLinks: false
    });

    expect(feed.changelog.publicTheme).toBe("dark");
  });
});
