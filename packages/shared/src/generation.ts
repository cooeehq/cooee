import {
  containsPersonallyIdentifiableContent,
  sanitizePullRequest,
} from "./privacy";
import {
  defaultChangelogCategoryDefinitions,
  getChangelogCategoryIds,
  getPullRequestCategoryOverride,
  normalizeChangelogCategoryDefinitions,
} from "./categories";
import type {
  ChangelogCategory,
  ChangelogCategoryDefinition,
  ChangelogChangeItem,
  PullRequestMetadata,
  SanitizedPullRequest,
} from "./types";

export type PromptPayload = {
  instructions: string;
  rewriteInstructions?: string;
  learnings?: Array<{
    title: string;
    summary: string;
    category: ChangelogCategory;
    note?: string | null;
    feedbackKind?: "dismissed" | "relevant" | "merged";
    sourcePullRequests?: Array<{
      number: number;
      title?: string;
      url: string;
    }>;
  }>;
  categories: ChangelogCategoryDefinition[];
  pullRequests: Array<Omit<SanitizedPullRequest, "id">>;
};

export type AiAudience = "product-users" | "technical-users";
export type AiPersonality = "product-user" | "concise" | "technical";
export type RepositoryVisibility = "private" | "public";

export type AiWritingOptions = {
  aiAudience?: AiAudience;
  aiPersonality?: AiPersonality;
  repositoryVisibility?: RepositoryVisibility;
};

export type GeneratedEntryCandidate = {
  title: unknown;
  summary: unknown;
  category: unknown;
  items?: unknown;
  skippedPullRequestNumbers?: unknown;
  confidence: unknown;
  sensitive: unknown;
};

export type GeneratedChangeItem = ChangelogChangeItem & {
  sourcePullRequestNumbers?: number[];
};

export type GeneratedEntryValidation =
  | {
      ok: true;
      entry: {
        title: string;
        summary: string;
        category: ChangelogCategory;
        confidence: number;
        items?: GeneratedChangeItem[];
        skippedPullRequestNumbers?: number[];
      };
    }
  | {
      ok: false;
      reason: "invalid-output" | "low-confidence" | "sensitive-output";
    };

export function buildPromptPayload(
  pullRequests: PullRequestMetadata[],
  options?: {
    categoryDefinitions?: ChangelogCategoryDefinition[];
    learnings?: PromptPayload["learnings"];
    rewriteInstructions?: string;
  } & AiWritingOptions,
): PromptPayload {
  const categories = normalizeChangelogCategoryDefinitions(
    options?.categoryDefinitions,
  );
  const marketingCopyCategoryIds = categories
    .filter(
      (category) =>
        (category.displayType === "post" ||
          category.displayType === "article") &&
        category.marketingCopy === true,
    )
    .map((category) => category.id);

  return {
    instructions: [
      buildAudienceInstruction(options),
      'Use a product-descriptive voice by default. Describe what the product, feature, or workflow does without repeatedly addressing the reader. Use second-person wording such as "you" and "your" only when direct address makes the meaning clearer or is needed to explain an action. Do not substitute third-person audience labels such as users, merchants, customers, store owners, or teams for unnecessary second-person wording unless the change genuinely affects a different group than the reader.',
      "Create one item per unique customer-facing change. Do not combine unrelated changes into one title or summary. Use only the configured category ids.",
      "Treat dismissed learnings as repository-specific publishing guidance. When a current pull request matches a dismissed learning and is not customer-facing, omit it from items and include its number in skippedPullRequestNumbers. Treat relevant learnings as corrections that similar pull requests should remain eligible. Treat merged learnings as guidance to combine directly related pull requests. Every current pull request must appear in exactly one item or in skippedPullRequestNumbers.",
      buildPersonalityInstruction(options),
      buildCategoryOverrideInstruction(pullRequests, categories),
      marketingCopyCategoryIds.length > 0
        ? `Write fuller feature-marketing posts for post display categories mapped to marketing copy: ${marketingCopyCategoryIds.join(", ")}. Lead with user value, describe the feature outcome, and keep the tone benefit-led without inventing claims.`
        : "",
      buildImplementationDetailInstruction(options),
      "Avoid private details, authors, trade secrets, code, credentials, implementation internals, and changes that conflict with user feedback learnings.",
    ]
      .filter(Boolean)
      .join(" "),
    ...(options?.learnings?.length ? { learnings: options.learnings } : {}),
    ...(options?.rewriteInstructions?.trim()
      ? { rewriteInstructions: options.rewriteInstructions.trim() }
      : {}),
    categories,
    pullRequests: pullRequests.map((pr) => {
      const { id: _id, ...sanitized } = sanitizePullRequest(pr);
      return sanitized;
    }),
  };
}

function buildCategoryOverrideInstruction(
  pullRequests: PullRequestMetadata[],
  categories: ChangelogCategoryDefinition[],
): string {
  const overrides = pullRequests.flatMap((pullRequest) => {
    const category = getPullRequestCategoryOverride(
      pullRequest.labels,
      categories,
    );
    return category ? [`PR #${pullRequest.number} must use ${category}`] : [];
  });

  return overrides.length > 0
    ? `PR labels named cooee:<category-id> are authoritative category assignments. ${overrides.join("; ")}. Do not combine PRs assigned to different categories into one item.`
    : "PR labels named cooee:<category-id> are authoritative category assignments when the category id is configured.";
}

export function buildImplementationDetailInstruction(
  options?: AiWritingOptions,
): string {
  const repositoryVisibility = options?.repositoryVisibility ?? "private";
  const technicalWriting =
    options?.aiAudience === "technical-users" ||
    options?.aiPersonality === "technical";

  if (repositoryVisibility === "public" && technicalWriting) {
    return "For public or open-source repositories with a technical writing style, implementation details may be mentioned only when they are material to the reader and present in the sanitized pull request metadata. Do not invent backend libraries, third-party tools, service providers, architecture, or code-level details.";
  }

  return [
    "Do not name backend libraries, internal frameworks, third-party tools, or service providers unless the repository is public/open-source and the selected writing style is technical.",
    repositoryVisibility === "private"
      ? "Private repositories must keep those implementation details unmentioned even for technical readers."
      : "For product-user and concise writing styles, translate implementation work into customer-facing outcomes instead of naming implementation details.",
  ].join(" ");
}

function buildAudienceInstruction(options?: AiWritingOptions): string {
  const audience =
    options?.aiAudience ??
    (options?.aiPersonality === "technical"
      ? "technical-users"
      : "product-users");

  return audience === "technical-users"
    ? "Write public technical-user changelog posts from sanitized pull request metadata only."
    : "Write public product-user changelog posts from sanitized pull request metadata only.";
}

function buildPersonalityInstruction(options?: AiWritingOptions): string {
  switch (options?.aiPersonality) {
    case "technical":
      return "Use precise technical wording when it explains reader impact, while keeping the post understandable without source-code context.";
    case "concise":
      return "Keep titles and summaries short, direct, and free of filler.";
    case "product-user":
    default:
      return "Lead with practical user value and describe outcomes in customer-facing language.";
  }
}

export function validateGeneratedEntry(
  candidate: GeneratedEntryCandidate,
  options?: { categoryDefinitions?: ChangelogCategoryDefinition[] },
): GeneratedEntryValidation {
  const categories = new Set(
    getChangelogCategoryIds(
      normalizeChangelogCategoryDefinitions(
        options?.categoryDefinitions,
        defaultChangelogCategoryDefinitions,
      ),
    ),
  );

  if (
    typeof candidate.title !== "string" ||
    typeof candidate.summary !== "string" ||
    typeof candidate.category !== "string" ||
    typeof candidate.confidence !== "number" ||
    typeof candidate.sensitive !== "boolean" ||
    !categories.has(candidate.category as ChangelogCategory) ||
    candidate.title.trim().length === 0 ||
    candidate.summary.trim().length === 0
  ) {
    return { ok: false, reason: "invalid-output" };
  }

  if (candidate.sensitive) {
    return { ok: false, reason: "sensitive-output" };
  }

  if (candidate.confidence < 0.8) {
    return { ok: false, reason: "low-confidence" };
  }

  const items = normalizeGeneratedItems(candidate.items, categories);
  const skippedPullRequestNumbers = normalizeSourcePullRequestNumbers(
    candidate.skippedPullRequestNumbers,
  );

  if (items === null || skippedPullRequestNumbers === null) {
    return { ok: false, reason: "invalid-output" };
  }

  const outputText = [
    candidate.title,
    candidate.summary,
    ...items.flatMap((item) => [item.title, item.summary]),
  ].join("\n");

  if (containsPersonallyIdentifiableContent(outputText)) {
    return { ok: false, reason: "sensitive-output" };
  }

  return {
    ok: true,
    entry: {
      title: candidate.title.trim(),
      summary: candidate.summary.trim(),
      category: candidate.category as ChangelogCategory,
      confidence: candidate.confidence,
      ...(items.length > 0 ? { items } : {}),
      ...(skippedPullRequestNumbers.length > 0
        ? { skippedPullRequestNumbers }
        : {}),
    },
  };
}

function normalizeGeneratedItems(
  input: unknown,
  categories: Set<ChangelogCategory>,
): GeneratedChangeItem[] | null {
  if (input === undefined) {
    return [];
  }

  if (!Array.isArray(input)) {
    return null;
  }

  const items: GeneratedChangeItem[] = [];
  for (const item of input) {
    if (
      !item ||
      typeof item !== "object" ||
      !("title" in item) ||
      !("summary" in item) ||
      !("category" in item)
    ) {
      return null;
    }

    const title = typeof item.title === "string" ? item.title.trim() : "";
    const summary = typeof item.summary === "string" ? item.summary.trim() : "";
    const category = item.category;
    const sourcePullRequestNumbers = normalizeSourcePullRequestNumbers(
      "sourcePullRequestNumbers" in item
        ? item.sourcePullRequestNumbers
        : undefined,
    );

    if (
      title.length === 0 ||
      summary.length === 0 ||
      typeof category !== "string" ||
      !categories.has(category as ChangelogCategory) ||
      sourcePullRequestNumbers === null
    ) {
      return null;
    }

    items.push({
      title,
      summary,
      category: category as ChangelogCategory,
      ...(sourcePullRequestNumbers.length > 0
        ? { sourcePullRequestNumbers }
        : {}),
    });
  }

  return items;
}

function normalizeSourcePullRequestNumbers(input: unknown): number[] | null {
  if (input === undefined) {
    return [];
  }

  if (!Array.isArray(input)) {
    return null;
  }

  const numbers = new Set<number>();
  for (const value of input) {
    if (!Number.isInteger(value) || value < 1) {
      return null;
    }

    numbers.add(value);
  }

  return [...numbers];
}
