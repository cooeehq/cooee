export type ChangelogCategory = string;

export type ChangelogDisplayType = "article" | "post" | "callout" | "text";
export type ChangelogPublicTheme = "light" | "dark";
export type ChangelogLogoAlignment = "left" | "center" | "right";

export type ChangelogCategoryDefinition = {
  id: ChangelogCategory;
  label: string;
  displayType: ChangelogDisplayType;
  marketingCopy?: boolean;
};

export type ChangelogEntryStatus = "draft" | "held" | "published" | "discarded";

export type ChangelogChangeItem = {
  title: string;
  summary: string;
  category: ChangelogCategory;
};

export type PullRequestMetadata = {
  id: string;
  number: number;
  title: string;
  body: string;
  labels: string[];
  mergedAt: string;
  url: string;
  repository: string;
  author?: string;
};

export type SanitizedPullRequest = Omit<PullRequestMetadata, "author">;

export type ChangelogEntry = {
  id: string;
  title: string;
  summary: string;
  category: ChangelogCategory;
  status: ChangelogEntryStatus;
  publishedAt: string | null;
  imageUrl?: string | null;
  articleSlug?: string | null;
  articleMarkdown?: string | null;
  items?: ChangelogChangeItem[];
  sourcePullRequests: Array<{
    number: number;
    title?: string;
    url: string;
    author?: string;
    mergedAt?: string;
  }>;
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
  articleSlug?: string | null;
  items?: ChangelogChangeItem[];
  sourcePullRequests?: Array<{
    number: number;
    title?: string;
    url: string;
  }>;
};

export type PublicArticleEntry = PublicFeedEntry & {
  articleSlug: string;
  articleMarkdown: string;
};

export type PublicArticle = {
  changelog: PublicChangelog;
  entry: PublicArticleEntry;
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
