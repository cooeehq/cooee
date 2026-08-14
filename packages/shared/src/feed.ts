import type {
  ChangelogEntry,
  PublicChangelog,
  PublicFeed,
  PublicFeedEntry,
  PublicFeedPagination,
} from "./types";
import {
  compareChangelogCategories,
  defaultChangelogCategoryDefinitions,
  getChangelogCategoryIds,
  normalizeChangelogCategoryDefinitions,
} from "./categories";

export function serializePublicFeed(input: {
  changelog: PublicChangelog;
  entries: ChangelogEntry[];
  includePullRequestLinks: boolean;
  generatedAt?: string;
  pagination?: PublicFeedPagination;
}): PublicFeed {
  const categoryDefinitions = normalizeChangelogCategoryDefinitions(
    input.changelog.categoryDefinitions,
  );
  const entries = input.entries
    .filter((entry): entry is ChangelogEntry & { publishedAt: string } => {
      return (
        entry.status === "published" && typeof entry.publishedAt === "string"
      );
    })
    .sort(
      (a, b) =>
        b.publishedAt.localeCompare(a.publishedAt) ||
        compareChangelogCategories(a.category, b.category, categoryDefinitions),
    )
    .map((entry) =>
      toPublicEntry(entry, input.includePullRequestLinks, categoryDefinitions),
    );
  const groupCategories = [
    ...getChangelogCategoryIds(categoryDefinitions),
    ...entries
      .map((entry) => entry.category)
      .filter(
        (category) => !categoryDefinitions.some((item) => item.id === category),
      ),
  ];

  const groups = Object.fromEntries(
    groupCategories.map((category) => [
      category,
      entries.filter((entry) => entry.category === category),
    ]),
  ) as Record<string, PublicFeedEntry[]>;

  return {
    changelog: {
      ...input.changelog,
      publicTheme: input.changelog.publicTheme ?? "light",
      publicLogoAlignment: input.changelog.publicLogoAlignment ?? "left",
      categoryDefinitions:
        input.changelog.categoryDefinitions ??
        defaultChangelogCategoryDefinitions,
    },
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    entries,
    groups,
    ...(input.pagination ? { pagination: input.pagination } : {}),
  };
}

function toPublicEntry(
  entry: ChangelogEntry & { publishedAt: string },
  includePullRequestLinks: boolean,
  categoryDefinitions = defaultChangelogCategoryDefinitions,
): PublicFeedEntry {
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    category: entry.category,
    publishedAt: entry.publishedAt,
    ...(entry.imageUrl ? { imageUrl: entry.imageUrl } : {}),
    ...(entry.articleSlug ? { articleSlug: entry.articleSlug } : {}),
    ...(entry.items && entry.items.length > 0
      ? {
          items: [...entry.items].sort((left, right) =>
            compareChangelogCategories(
              left.category,
              right.category,
              categoryDefinitions,
            ),
          ),
        }
      : {}),
    ...(includePullRequestLinks
      ? {
          sourcePullRequests: entry.sourcePullRequests.map((pr) => ({
            number: pr.number,
            url: pr.url,
          })),
        }
      : {}),
  };
}
