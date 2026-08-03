import type {
  ChangelogCategory,
  ChangelogCategoryDefinition,
  ChangelogDisplayType,
} from "./types";

export const changelogDisplayTypes: ChangelogDisplayType[] = [
  "article",
  "post",
  "callout",
  "text",
];

export const defaultChangelogCategoryDefinitions: ChangelogCategoryDefinition[] =
  [
    {
      id: "feature",
      label: "Feature",
      displayType: "article",
      marketingCopy: true,
    },
    {
      id: "improvement",
      label: "Improvement",
      displayType: "callout",
      marketingCopy: false,
    },
    { id: "fix", label: "Fix", displayType: "text", marketingCopy: false },
    {
      id: "maintenance",
      label: "Maintenance",
      displayType: "text",
      marketingCopy: false,
    },
  ];

export const changelogCategoryOrder: ChangelogCategory[] =
  defaultChangelogCategoryDefinitions.map((category) => category.id);

export function compareChangelogCategories(
  left: ChangelogCategory,
  right: ChangelogCategory,
  definitions: ChangelogCategoryDefinition[] = defaultChangelogCategoryDefinitions,
): number {
  return categoryRank(left, definitions) - categoryRank(right, definitions);
}

export function categoryRank(
  category: ChangelogCategory,
  definitions: ChangelogCategoryDefinition[] = defaultChangelogCategoryDefinitions,
): number {
  const normalized = normalizeChangelogCategoryId(category);
  const rank = definitions.findIndex(
    (definition) => definition.id === normalized,
  );
  return rank >= 0 ? rank : definitions.length;
}

export function normalizeChangelogCategoryDefinitions(
  input: unknown,
  fallback: ChangelogCategoryDefinition[] = defaultChangelogCategoryDefinitions,
): ChangelogCategoryDefinition[] {
  if (!Array.isArray(input)) {
    return normalizeCategoryDefinitionArray(fallback);
  }

  return normalizeCategoryDefinitionArray(input, fallback);
}

function normalizeCategoryDefinitionArray(
  input: unknown[],
  fallback: ChangelogCategoryDefinition[] = defaultChangelogCategoryDefinitions,
): ChangelogCategoryDefinition[] {
  const fallbackDefinitions =
    fallback.length > 0 ? fallback : defaultChangelogCategoryDefinitions;
  const fallbackMarketingCopyById = new Map(
    fallbackDefinitions.map((definition) => [
      definition.id,
      definition.marketingCopy,
    ]),
  );

  const definitions: ChangelogCategoryDefinition[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const label =
      typeof record.label === "string"
        ? normalizeCategoryLabel(record.label)
        : "";
    const id =
      typeof record.id === "string"
        ? normalizeChangelogCategoryId(record.id)
        : normalizeChangelogCategoryId(label);
    const displayType =
      typeof record.displayType === "string" &&
      isChangelogDisplayType(record.displayType)
        ? record.displayType
        : "post";
    const marketingCopy = normalizeCategoryMarketingCopy(
      record.marketingCopy,
      id,
      displayType,
      fallbackMarketingCopyById.get(id),
    );

    if (!id || !label || seen.has(id)) {
      continue;
    }

    seen.add(id);
    definitions.push({ id, label, displayType, marketingCopy });
  }

  return definitions.length > 0 ? definitions : [...fallbackDefinitions];
}

export function normalizeChangelogCategoryId(value: string): ChangelogCategory {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || ""
  );
}

export function getChangelogCategoryDefinition(
  category: ChangelogCategory,
  definitions: ChangelogCategoryDefinition[] = defaultChangelogCategoryDefinitions,
): ChangelogCategoryDefinition {
  const normalized = normalizeChangelogCategoryId(category);
  return (
    definitions.find((definition) => definition.id === normalized) ?? {
      id: normalized || category,
      label: humanizeCategory(category),
      displayType: "post",
      marketingCopy: false,
    }
  );
}

export function getChangelogCategoryLabel(
  category: ChangelogCategory,
  definitions: ChangelogCategoryDefinition[] = defaultChangelogCategoryDefinitions,
): string {
  return getChangelogCategoryDefinition(category, definitions).label;
}

export function getChangelogCategoryDisplayType(
  category: ChangelogCategory,
  definitions: ChangelogCategoryDefinition[] = defaultChangelogCategoryDefinitions,
): ChangelogDisplayType {
  return getChangelogCategoryDefinition(category, definitions).displayType;
}

export function getChangelogCategoryIds(
  definitions: ChangelogCategoryDefinition[] = defaultChangelogCategoryDefinitions,
): ChangelogCategory[] {
  return definitions.map((definition) => definition.id);
}

export function getPullRequestCategoryOverride(
  labels: string[],
  definitions: ChangelogCategoryDefinition[] = defaultChangelogCategoryDefinitions,
): ChangelogCategory | null {
  const categoryLabels = new Set(
    labels.map((label) => label.trim().toLowerCase()),
  );

  return (
    definitions.find((definition) =>
      categoryLabels.has(`cooee:${definition.id.trim().toLowerCase()}`),
    )?.id ?? null
  );
}

function normalizeCategoryLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 48);
}

function isChangelogDisplayType(value: string): value is ChangelogDisplayType {
  return changelogDisplayTypes.includes(value as ChangelogDisplayType);
}

function normalizeCategoryMarketingCopy(
  value: unknown,
  id: ChangelogCategory,
  displayType: ChangelogDisplayType,
  fallback: boolean | undefined,
): boolean {
  if (displayType !== "post" && displayType !== "article") {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return fallback ?? id === "feature";
}

function humanizeCategory(category: string): string {
  const words = category
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "Update";
  }

  return words
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}
