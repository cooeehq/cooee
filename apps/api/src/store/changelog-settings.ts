import type { ChangelogSettings, WorkspaceSettings } from "./types";

export type RepositoryScopedSettings = Required<
  Pick<
    ChangelogSettings,
    | "publicChangelog"
    | "publicLogoAlignment"
    | "logoAssetKey"
    | "logoUrl"
    | "lightLogoAssetKey"
    | "lightLogoUrl"
    | "faviconAssetKey"
    | "faviconUrl"
    | "publicAppUrl"
    | "publicAppLabel"
    | "aiMinimumConfidence"
    | "aiAudience"
    | "aiPersonality"
    | "aiProductContext"
    | "aiFailClosed"
    | "autoPublish"
    | "historicalBackfillDays"
  >
>;

export const defaultRepositoryScopedSettings: RepositoryScopedSettings = {
  publicChangelog: true,
  publicLogoAlignment: "left",
  logoAssetKey: null,
  logoUrl: null,
  lightLogoAssetKey: null,
  lightLogoUrl: null,
  faviconAssetKey: null,
  faviconUrl: null,
  publicAppUrl: "",
  publicAppLabel: "Open app",
  aiMinimumConfidence: "0.80",
  aiAudience: "product-users",
  aiPersonality: "product-user",
  aiProductContext: "",
  aiFailClosed: true,
  autoPublish: false,
  historicalBackfillDays: 14,
};

export function resolveRepositoryScopedSettings(
  settings: ChangelogSettings,
  fallback?: Partial<RepositoryScopedSettings>,
): RepositoryScopedSettings {
  return {
    publicChangelog:
      settings.publicChangelog ?? fallback?.publicChangelog ?? true,
    publicLogoAlignment:
      settings.publicLogoAlignment === "center" ||
      settings.publicLogoAlignment === "right"
        ? settings.publicLogoAlignment
        : fallback?.publicLogoAlignment === "center" ||
            fallback?.publicLogoAlignment === "right"
          ? fallback.publicLogoAlignment
          : "left",
    logoAssetKey: settings.logoAssetKey ?? fallback?.logoAssetKey ?? null,
    logoUrl: settings.logoUrl ?? fallback?.logoUrl ?? null,
    lightLogoAssetKey:
      settings.lightLogoAssetKey ?? fallback?.lightLogoAssetKey ?? null,
    lightLogoUrl: settings.lightLogoUrl ?? fallback?.lightLogoUrl ?? null,
    faviconAssetKey:
      settings.faviconAssetKey ?? fallback?.faviconAssetKey ?? null,
    faviconUrl: settings.faviconUrl ?? fallback?.faviconUrl ?? null,
    publicAppUrl:
      settings.publicAppUrl?.trim() ?? fallback?.publicAppUrl?.trim() ?? "",
    publicAppLabel:
      settings.publicAppLabel?.trim() ||
      fallback?.publicAppLabel?.trim() ||
      "Open app",
    aiMinimumConfidence:
      settings.aiMinimumConfidence ?? fallback?.aiMinimumConfidence ?? "0.80",
    aiAudience:
      settings.aiAudience === "technical-users" ||
      (settings.aiAudience === undefined &&
        fallback?.aiAudience === "technical-users")
        ? "technical-users"
        : "product-users",
    aiPersonality:
      settings.aiPersonality === "technical" ||
      settings.aiPersonality === "concise"
        ? settings.aiPersonality
        : settings.aiPersonality === undefined &&
            (fallback?.aiPersonality === "technical" ||
              fallback?.aiPersonality === "concise")
          ? fallback.aiPersonality
          : "product-user",
    aiProductContext: (
      settings.aiProductContext ??
      fallback?.aiProductContext ??
      ""
    )
      .trim()
      .slice(0, 5_000),
    aiFailClosed: settings.aiFailClosed ?? fallback?.aiFailClosed ?? true,
    autoPublish: settings.autoPublish ?? fallback?.autoPublish ?? false,
    historicalBackfillDays:
      settings.historicalBackfillDays ?? fallback?.historicalBackfillDays ?? 14,
  };
}

export function repositoryScopedSettingsFromWorkspace(
  settings: WorkspaceSettings,
): RepositoryScopedSettings {
  return {
    publicChangelog: settings.publicChangelog,
    publicLogoAlignment: settings.publicLogoAlignment,
    logoAssetKey: settings.logoAssetKey,
    logoUrl: settings.logoUrl,
    lightLogoAssetKey: settings.lightLogoAssetKey,
    lightLogoUrl: settings.lightLogoUrl,
    faviconAssetKey: settings.faviconAssetKey,
    faviconUrl: settings.faviconUrl,
    publicAppUrl: settings.publicAppUrl,
    publicAppLabel: settings.publicAppLabel,
    aiMinimumConfidence: settings.aiMinimumConfidence,
    aiAudience: settings.aiAudience,
    aiPersonality: settings.aiPersonality,
    aiProductContext: settings.aiProductContext,
    aiFailClosed: settings.aiFailClosed,
    autoPublish: settings.autoPublish,
    historicalBackfillDays: settings.historicalBackfillDays,
  };
}
