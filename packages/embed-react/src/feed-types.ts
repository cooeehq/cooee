// Public feed types published with @cooeehq/react. These mirror the feed
// shapes in @cooee/shared, duplicated here so the published package has no
// dependency on workspace-only packages. A compile-time parity test in
// __tests__/feed-types.test.ts fails if the two drift apart.

export type ChangelogCategory = string;

export type ChangelogDisplayType = "post" | "callout" | "text";
export type ChangelogPublicTheme = "light" | "dark";
export type ChangelogLogoAlignment = "left" | "center" | "right";

export type ChangelogCategoryDefinition = {
  id: ChangelogCategory;
  label: string;
  displayType: ChangelogDisplayType;
  marketingCopy?: boolean;
};

export type ChangelogChangeItem = {
  title: string;
  summary: string;
  category: ChangelogCategory;
};

export type PublicChangelog = {
  slug: string;
  name: string;
  description: string | null;
  publicUrl: string;
  logoUrl?: string | null;
  lightLogoUrl?: string | null;
  faviconUrl?: string | null;
  publicTheme?: ChangelogPublicTheme;
  publicLogoAlignment?: ChangelogLogoAlignment;
  publicAppUrl?: string | null;
  publicAppLabel?: string | null;
  categoryDefinitions?: ChangelogCategoryDefinition[];
  groupEntriesByCategory?: boolean;
};

export type PublicFeedEntry = {
  id: string;
  title: string;
  summary: string;
  category: ChangelogCategory;
  publishedAt: string;
  imageUrl?: string | null;
  items?: ChangelogChangeItem[];
  sourcePullRequests?: Array<{
    number: number;
    title?: string;
    url: string;
  }>;
};

export type PublicFeedPagination = {
  hasMore: boolean;
  nextBefore: string | null;
  windowStartedAt: string | null;
  windowEndedAt: string | null;
};

export type PublicFeed = {
  changelog: PublicChangelog;
  generatedAt: string;
  entries: PublicFeedEntry[];
  groups: Record<string, PublicFeedEntry[]>;
  pagination?: PublicFeedPagination;
};
