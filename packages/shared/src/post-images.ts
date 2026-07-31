export const postImageModes = [
  "brand-card",
  "reference",
  "illustration",
] as const;

export const postImageBackgroundPatterns = [
  "space",
  "sky",
  "cyberpunk",
  "server-room",
  "road",
  "soft-gradient",
  "mesh-gradient",
  "soft-blobs",
  "solid",
] as const;

export const postImageIllustrationStyles = [
  "soft-3d",
  "geometric",
  "cut-paper",
  "technical-sketch",
  "custom",
] as const;

export type PostImageMode = (typeof postImageModes)[number];
export type PostImageBackgroundPattern =
  (typeof postImageBackgroundPatterns)[number];
export type PostImageIllustrationStyle =
  (typeof postImageIllustrationStyles)[number];

export type PostImageSettings = {
  enabled: boolean;
  mode: PostImageMode;
  accentColor: string;
  titleOverlay: boolean;
  backgroundPattern: PostImageBackgroundPattern;
  referenceAssetKey: string | null;
  illustrationStyle: PostImageIllustrationStyle;
  defaultPrompt: string;
};

export const defaultPostImageSettings: PostImageSettings = {
  enabled: false,
  mode: "brand-card",
  accentColor: "#10B981",
  titleOverlay: true,
  backgroundPattern: "space",
  referenceAssetKey: null,
  illustrationStyle: "soft-3d",
  defaultPrompt: "",
};

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizePostImageSettings(
  value: unknown,
  options?: { legacyEnabled?: boolean },
): PostImageSettings {
  const input = isRecord(value) ? value : {};
  const enabled =
    typeof input.enabled === "boolean"
      ? input.enabled
      : (options?.legacyEnabled ?? defaultPostImageSettings.enabled);

  return {
    enabled,
    mode: includes(postImageModes, input.mode)
      ? input.mode
      : defaultPostImageSettings.mode,
    accentColor: isHexColor(input.accentColor)
      ? input.accentColor.toUpperCase()
      : defaultPostImageSettings.accentColor,
    titleOverlay:
      typeof input.titleOverlay === "boolean"
        ? input.titleOverlay
        : defaultPostImageSettings.titleOverlay,
    backgroundPattern: includes(
      postImageBackgroundPatterns,
      input.backgroundPattern,
    )
      ? input.backgroundPattern
      : defaultPostImageSettings.backgroundPattern,
    referenceAssetKey:
      typeof input.referenceAssetKey === "string" &&
      input.referenceAssetKey.trim()
        ? input.referenceAssetKey.trim()
        : null,
    illustrationStyle: includes(
      postImageIllustrationStyles,
      input.illustrationStyle,
    )
      ? input.illustrationStyle
      : defaultPostImageSettings.illustrationStyle,
    defaultPrompt:
      typeof input.defaultPrompt === "string"
        ? input.defaultPrompt.trim().slice(0, 1_000)
        : defaultPostImageSettings.defaultPrompt,
  };
}

function includes<const T extends readonly string[]>(
  options: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && options.includes(value as T[number]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
