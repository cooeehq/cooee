import type {
  PostImageBackgroundPattern,
  PostImageIllustrationStyle,
  PostImageSettings,
} from "@cooee/shared";
import { readFile } from "node:fs/promises";
import * as opentype from "opentype.js";
import sharp from "sharp";
import type { StoredAsset } from "./assets";
import type { AiImageGenerator, AiImageResult, AiTokenUsage } from "./openai";

export const postImageWidth = 1536;
export const postImageHeight = 1024;
export const maxPostImageBytes = 3 * 1024 * 1024;
export const maxReferenceImageBytes = 10 * 1024 * 1024;
const postImageTitleFontUrl = new URL(
  "../assets/fonts/Geist-SemiBold.otf",
  import.meta.url,
);
let postImageTitleFontPromise: Promise<opentype.Font> | undefined;

export type RenderPostImageInput = {
  category: string;
  title: string;
  summary: string;
  instructions?: string;
  settings: PostImageSettings;
  reference?: StoredAsset | null;
};

export type RenderedPostImage = StoredAsset & {
  requestId?: string;
  usage?: AiTokenUsage;
};

type PostImageComposite = {
  input: Buffer;
  blend: "over";
  left?: number;
  top?: number;
};

export class PostImageGenerationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "PostImageGenerationError";
  }
}

export class PostImageOrchestrator {
  constructor(private readonly imageGenerator: AiImageGenerator) {}

  async render(input: RenderPostImageInput): Promise<RenderedPostImage> {
    if (input.settings.mode === "brand-card") {
      return renderBrandCard(input);
    }

    const prompt = buildPostImagePrompt(input);
    let generated: AiImageResult;
    try {
      if (input.settings.mode === "reference") {
        if (!input.reference) {
          throw new PostImageGenerationError(
            "The reference image is missing. Upload it again and retry.",
            false,
          );
        }
        if (!this.imageGenerator.editPostImage) {
          throw new PostImageGenerationError(
            "Reference image generation is not configured.",
            false,
          );
        }
        generated = await this.imageGenerator.editPostImage({
          image: input.reference.body,
          contentType: input.reference.contentType,
          prompt,
        });
      } else {
        generated = await this.imageGenerator.generatePostImage({
          category: input.category,
          title: input.title,
          summary: input.summary,
          prompt,
        });
      }
    } catch (error) {
      if (error instanceof PostImageGenerationError) throw error;
      throw classifyProviderError(error);
    }

    const source = await readGeneratedImage(generated.imageUrl);
    if (!source) {
      throw new PostImageGenerationError(
        "The generated image could not be read.",
        true,
        generated.requestId,
      );
    }
    const body = await normalizePostImage(
      source,
      input.settings,
      input.title,
    );
    return {
      body,
      contentType: "image/webp",
      ...(generated.requestId ? { requestId: generated.requestId } : {}),
      ...(generated.usage ? { usage: generated.usage } : {}),
    };
  }
}

export async function normalizeReferenceImage(
  body: Uint8Array,
): Promise<StoredAsset> {
  if (body.byteLength > maxReferenceImageBytes) {
    throw new PostImageGenerationError(
      "Reference images must be 10MB or smaller.",
      false,
    );
  }
  try {
    const normalized = await sharp(body)
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 88 })
      .toBuffer();
    return { body: normalized, contentType: "image/webp" };
  } catch {
    throw new PostImageGenerationError(
      "Upload a valid PNG, JPEG, or WebP image.",
      false,
    );
  }
}

export function buildPostImagePrompt(input: RenderPostImageInput): string {
  const savedDirection = input.settings.defaultPrompt.trim();
  const oneOffDirection = input.instructions?.trim().slice(0, 1_000) ?? "";
  const modeDirection =
    input.settings.mode === "reference"
      ? "Use the supplied master image only as a style reference for palette, materials, lighting, texture, and visual language. Create a new composition for this post; do not reproduce its layout."
      : illustrationStylePrompt(input.settings.illustrationStyle);

  return [
    "Create a polished editorial hero image for a public product changelog.",
    modeDirection,
    savedDirection ? `Saved art direction: ${savedDirection}` : "",
    `Post category: ${input.category}`,
    `Post title for context only: ${input.title}`,
    `Post summary for context only: ${input.summary}`,
    `Brand accent colour: ${input.settings.accentColor}. Use it as a restrained visual accent, not as text.`,
    oneOffDirection
      ? `One-off direction for this image: ${oneOffDirection}`
      : "",
    "Do not include any words, letters, numbers, captions, logos, brand marks, screenshots, UI mockups, code, people, private implementation details, or invented product interfaces.",
    "The result must work as a clean 3:2 changelog card image with important detail kept away from the perimeter.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function renderBrandCard(
  input: RenderPostImageInput,
): Promise<RenderedPostImage> {
  const { settings } = input;
  const assetUrl = environmentalBackgroundAssets[settings.backgroundPattern];
  let source: Uint8Array;
  if (assetUrl) {
    source = new Uint8Array(await readFile(assetUrl));
  } else {
    source = new Uint8Array(
      await sharp(Buffer.from(brandCardSvg(settings))).png().toBuffer(),
    );
  }

  const body = await normalizePostImage(source, settings, input.title);
  return { body, contentType: "image/webp" };
}

const environmentalBackgroundAssets: Partial<
  Record<PostImageBackgroundPattern, URL>
> = {
  space: new URL(
    "../../../admin/public/post-image-backgrounds/space.webp",
    import.meta.url,
  ),
  sky: new URL(
    "../../../admin/public/post-image-backgrounds/sky.webp",
    import.meta.url,
  ),
  cyberpunk: new URL(
    "../../../admin/public/post-image-backgrounds/cyberpunk.webp",
    import.meta.url,
  ),
  "server-room": new URL(
    "../../../admin/public/post-image-backgrounds/server-room.webp",
    import.meta.url,
  ),
  road: new URL(
    "../../../admin/public/post-image-backgrounds/road.webp",
    import.meta.url,
  ),
};

function brandCardSvg(settings: PostImageSettings): string {
  const accent = settings.accentColor;
  const isSolid = settings.backgroundPattern === "solid";
  const background = isSolid ? accent : "#E9E9E7";
  const patterns: Partial<Record<PostImageBackgroundPattern, string>> = {
    "soft-gradient": softGradientPattern(),
    "mesh-gradient": meshGradientPattern(),
    "soft-blobs": softBlobPattern(),
    solid: "",
  };
  const pattern = patterns[settings.backgroundPattern];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${postImageWidth}" height="${postImageHeight}" viewBox="0 0 ${postImageWidth} ${postImageHeight}">
    <rect width="100%" height="100%" fill="${background}"/>
    ${pattern ?? ""}
  </svg>`;
}

function accentOverlaySvg(accent: string): string {
  return `<defs>
    <linearGradient id="accent-wash" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${accent}" stop-opacity=".2"/>
      <stop offset=".52" stop-color="${accent}" stop-opacity=".08"/>
      <stop offset="1" stop-color="${accent}" stop-opacity=".16"/>
    </linearGradient>
    <radialGradient id="accent-highlight" cx="82%" cy="18%" r="62%">
      <stop offset="0" stop-color="${accent}" stop-opacity=".28"/>
      <stop offset=".48" stop-color="${accent}" stop-opacity=".12"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="${accent}" fill-opacity=".38"/>
  <rect width="100%" height="100%" fill="url(#accent-wash)"/>
  <rect width="100%" height="100%" fill="url(#accent-highlight)"/>`;
}

function softGradientPattern(): string {
  return `<defs>
    <linearGradient id="soft-gradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FAFAF9"/>
      <stop offset=".48" stop-color="#D8D8D5"/>
      <stop offset="1" stop-color="#8D8D89"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#soft-gradient)"/>`;
}

function meshGradientPattern(): string {
  return `<defs>
    <radialGradient id="mesh-a" cx="0" cy="0" r="1" gradientTransform="translate(340 220) rotate(34) scale(930 720)">
      <stop stop-color="#FFFFFF"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="mesh-b" cx="0" cy="0" r="1" gradientTransform="translate(1260 790) rotate(-145) scale(980 680)">
      <stop stop-color="#686865"/><stop offset="1" stop-color="#686865" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="#C8C8C4"/>
  <rect width="100%" height="100%" fill="url(#mesh-a)"/>
  <rect width="100%" height="100%" fill="url(#mesh-b)" opacity=".72"/>`;
}

function softBlobPattern(): string {
  return `<defs><filter id="blur"><feGaussianBlur stdDeviation="95"/></filter></defs>
    <g filter="url(#blur)" opacity=".72">
      <ellipse cx="250" cy="250" rx="390" ry="300" fill="#FFFFFF"/>
      <ellipse cx="1210" cy="250" rx="360" ry="270" fill="#777773"/>
      <ellipse cx="880" cy="850" rx="520" ry="310" fill="#A5A5A1"/>
      <ellipse cx="120" cy="920" rx="330" ry="240" fill="#555552"/>
    </g>`;
}

function illustrationStylePrompt(style: PostImageIllustrationStyle): string {
  return {
    "soft-3d":
      "Style: soft tactile 3D forms, matte materials, diffused studio light, generous negative space, and restrained depth.",
    geometric:
      "Style: crisp geometric editorial illustration, bold flat shapes, controlled layering, and disciplined negative space.",
    "cut-paper":
      "Style: handcrafted cut-paper layers, subtle fibre texture, soft real shadows, and simple sculptural composition.",
    "technical-sketch":
      "Style: refined technical sketch with precise line work, light construction marks, sparse tonal wash, and editorial composition.",
    custom: "Follow the saved art direction as the primary illustration style.",
  }[style];
}

async function normalizePostImage(
  source: Uint8Array,
  settings: PostImageSettings,
  title: string,
): Promise<Uint8Array> {
  const normalized = await sharp(source)
    .rotate()
    .resize(postImageWidth, postImageHeight, { fit: "cover" })
    .png()
    .toBuffer();
  const shouldTint =
    settings.mode !== "brand-card" || settings.backgroundPattern !== "solid";
  const accentOverlay = Buffer.from(
    `<svg width="${postImageWidth}" height="${postImageHeight}" xmlns="http://www.w3.org/2000/svg">${accentOverlaySvg(settings.accentColor)}</svg>`,
  );
  const artwork = shouldTint
    ? await sharp(normalized)
        .composite([{ input: accentOverlay, blend: "over" }])
        .png()
        .toBuffer()
    : normalized;
  const titleComposites = settings.titleOverlay
    ? await createTitleComposites(artwork, title)
    : [];

  for (const quality of [84, 76, 68]) {
    const output = await sharp(artwork)
      .composite(titleComposites)
      .webp({ quality, effort: 4 })
      .toBuffer();
    if (output.byteLength <= maxPostImageBytes) return output;
  }
  throw new PostImageGenerationError(
    "The generated image exceeded the image size limit.",
    false,
  );
}

async function createTitleComposites(
  artwork: Uint8Array,
  title: string,
): Promise<PostImageComposite[]> {
  const lines = wrapPostImageTitle(title);
  if (lines.length === 0) return [];

  const region = {
    left: 64,
    top: 560,
    width: 1200,
    height: postImageHeight - 560,
  };
  const stats = await sharp(artwork).extract(region).stats();
  const luminance =
    stats.channels[0].mean * 0.2126 +
    stats.channels[1].mean * 0.7152 +
    stats.channels[2].mean * 0.0722;
  const useDarkText = luminance >= 154;
  const textColor = useDarkText ? "#171A18" : "#F5F7F5";
  const scrimColor = useDarkText ? "#F7F8F6" : "#101312";
  const scrimOpacity = useDarkText ? ".74" : ".66";
  const font = await loadPostImageTitleFont();
  const preferredFontSize =
    lines.length === 1 ? 104 : lines.length === 2 ? 88 : 74;
  const widestLine = Math.max(
    ...lines.map((line) =>
      font.getAdvanceWidth(line, preferredFontSize, { kerning: true }),
    ),
  );
  const fontSize = Math.max(
    58,
    Math.min(preferredFontSize, preferredFontSize * (1160 / widestLine)),
  );
  const lineHeight = fontSize * 1.08;
  const finalBaseline = postImageHeight - 86;
  const firstBaseline = finalBaseline - (lines.length - 1) * lineHeight;
  const titlePaths = lines
    .map((line, index) =>
      createTextPathMarkup(
        font,
        line,
        96,
        firstBaseline + index * lineHeight,
        fontSize,
        textColor,
      ),
    )
    .join("");
  const overlay = Buffer.from(
    `<svg width="${postImageWidth}" height="${postImageHeight}" viewBox="0 0 ${postImageWidth} ${postImageHeight}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="title-scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${scrimColor}" stop-opacity="0"/><stop offset=".56" stop-color="${scrimColor}" stop-opacity=".08"/><stop offset="1" stop-color="${scrimColor}" stop-opacity="${scrimOpacity}"/></linearGradient></defs><rect y="360" width="${postImageWidth}" height="${postImageHeight - 360}" fill="url(#title-scrim)"/>${titlePaths}</svg>`,
  );

  return [{ input: overlay, blend: "over" }];
}

function createTextPathMarkup(
  font: opentype.Font,
  value: string,
  x: number,
  baseline: number,
  fontSize: number,
  fill: string,
): string {
  const combinedPathData = font
    .getPath(value, x, baseline, fontSize, { kerning: true })
    .toPathData(2);
  if (!combinedPathData.includes("NaN")) {
    return `<path d="${closeSvgPathContours(combinedPathData)}" fill="${fill}"/>`;
  }

  const glyphs = font.stringToGlyphs(value);
  const scale = fontSize / font.unitsPerEm;
  let glyphX = x;

  return glyphs
    .map((glyph, index) => {
      // opentype.js can emit NaN coordinates for some CFF contours when the
      // accumulated glyph origin contains floating-point residue.
      const renderX = Math.round(glyphX * 1_000) / 1_000;
      const path = glyph.getPath(
        renderX,
        baseline,
        fontSize,
        { kerning: true },
        font,
      );
      const markup = `<path d="${closeSvgPathContours(path.toPathData(2))}" fill="${fill}"/>`;
      const nextGlyph = glyphs[index + 1];
      glyphX += (glyph.advanceWidth ?? font.unitsPerEm) * scale;
      if (nextGlyph) {
        glyphX += font.getKerningValue(glyph, nextGlyph) * scale;
      }
      return markup;
    })
    .join("");
}

function closeSvgPathContours(pathData: string): string {
  return pathData
    .split("M")
    .filter(Boolean)
    .map((contour) => `M${contour.replace(/Z+$/, "")}Z`)
    .join("");
}

function loadPostImageTitleFont(): Promise<opentype.Font> {
  postImageTitleFontPromise ??= readFile(postImageTitleFontUrl).then((body) =>
    opentype.parse(body),
  );
  return postImageTitleFontPromise;
}

function wrapPostImageTitle(value: string): string[] {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length === 0) return [];

  const maxCharacters = 27;
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === 2) break;
  }

  if (current && lines.length < 3) lines.push(current);
  const consumed = lines.join(" ").split(" ").length;
  if (consumed < words.length) {
    const finalLine = lines.at(-1) ?? "";
    lines[lines.length - 1] = `${finalLine.slice(0, maxCharacters - 1).trimEnd()}…`;
  }

  return lines.slice(0, 3);
}

async function readGeneratedImage(
  imageUrl: string,
): Promise<Uint8Array | null> {
  const match =
    /^data:image\/(?:png|jpeg|jpg|webp);base64,([a-z0-9+/=]+)$/i.exec(imageUrl);
  if (match) return Uint8Array.from(Buffer.from(match[1], "base64"));
  if (!/^https:\/\//i.test(imageUrl)) return null;
  const response = await fetch(imageUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

function classifyProviderError(error: unknown): PostImageGenerationError {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const requestId =
    typeof error === "object" && error !== null && "request_id" in error
      ? String((error as { request_id?: unknown }).request_id ?? "") ||
        undefined
      : undefined;
  const nonRetryable =
    status === 400 ||
    status === 401 ||
    status === 403 ||
    code.includes("moderation") ||
    code.includes("invalid");
  return new PostImageGenerationError(
    nonRetryable
      ? "The image request could not be generated. Review the image direction and retry."
      : "Image generation is temporarily unavailable.",
    !nonRetryable,
    requestId,
  );
}
