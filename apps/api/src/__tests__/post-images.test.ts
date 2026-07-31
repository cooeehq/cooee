import { describe, expect, test } from "bun:test";
import {
  defaultPostImageSettings,
  postImageBackgroundPatterns,
} from "@cooee/shared";
import sharp from "sharp";
import {
  buildPostImagePrompt,
  normalizeReferenceImage,
  PostImageOrchestrator,
} from "../services/post-images";
import { processPostImageGenerationJobs } from "../services/post-image-jobs";
import { InMemoryStore } from "../store/memory";
import type { AssetStorage } from "../services/assets";

async function sourceImage(colour = "#DDD6C8") {
  return new Uint8Array(
    await sharp({
      create: {
        width: 64,
        height: 48,
        channels: 3,
        background: colour,
      },
    })
      .png()
      .toBuffer(),
  );
}

describe("post image orchestrator", () => {
  test("renders every local pattern as a bounded 1536x1024 WebP", async () => {
    let aiCalls = 0;
    const orchestrator = new PostImageOrchestrator({
      generatePostImage: async () => {
        aiCalls += 1;
        throw new Error("AI must not be used for brand cards");
      },
    });
    for (const backgroundPattern of postImageBackgroundPatterns) {
      const output = await orchestrator.render({
        category: "feature",
        title: "A post",
        summary: "A summary",
        settings: { ...defaultPostImageSettings, backgroundPattern },
      });
      expect(output.contentType).toBe("image/webp");
      expect(output.body.byteLength).toBeLessThan(3 * 1024 * 1024);
      expect(await sharp(output.body).metadata()).toMatchObject({
        format: "webp",
        width: 1536,
        height: 1024,
      });
    }
    expect(aiCalls).toBe(0);
  });

  test("adds the title overlay by default and allows it to be disabled", async () => {
    const orchestrator = new PostImageOrchestrator({
      generatePostImage: async () => {
        throw new Error("AI must not be used for brand cards");
      },
    });
    const common = {
      category: "feature",
      title: "We've launched!",
      summary: "We just launched our changelog!",
    };
    const withTitle = await orchestrator.render({
      ...common,
      settings: {
        ...defaultPostImageSettings,
        backgroundPattern: "road",
      },
    });
    const withoutTitle = await orchestrator.render({
      ...common,
      settings: {
        ...defaultPostImageSettings,
        backgroundPattern: "road",
        titleOverlay: false,
      },
    });

    expect(withTitle.body).not.toEqual(withoutTitle.body);
    expect(await sharp(withTitle.body).metadata()).toMatchObject({
      format: "webp",
      width: 1536,
      height: 1024,
    });
  });

  test("renders punctuation contours in title overlays", async () => {
    const orchestrator = new PostImageOrchestrator({
      generatePostImage: async () => {
        throw new Error("AI must not be used for brand cards");
      },
    });
    const output = await orchestrator.render({
      category: "feature",
      title: "We've launched!",
      summary: "Punctuation rendering check.",
      settings: {
        ...defaultPostImageSettings,
        accentColor: "#102010",
        backgroundPattern: "solid",
      },
    });
    const dotRegion = await sharp(output.body)
      .extract({ left: 887, top: 923, width: 16, height: 16 })
      .png()
      .toBuffer();
    const dot = await sharp(dotRegion).stats();

    expect(dot.channels[0].max).toBeGreaterThan(235);
    expect(dot.channels[0].mean).toBeGreaterThan(180);
  });

  test("routes Reference to edit and Illustration to generation", async () => {
    const calls: string[] = [];
    const image = await sourceImage();
    const imageUrl = `data:image/png;base64,${Buffer.from(image).toString("base64")}`;
    const orchestrator = new PostImageOrchestrator({
      generatePostImage: async (input) => {
        calls.push(`generate:${input.prompt}`);
        return { imageUrl };
      },
      editPostImage: async (input) => {
        calls.push(`edit:${input.prompt}`);
        return { imageUrl };
      },
    });
    const common = {
      category: "feature",
      title: "Faster checkout",
      summary: "Checkout now needs fewer steps.",
    };
    await orchestrator.render({
      ...common,
      settings: { ...defaultPostImageSettings, mode: "reference" },
      reference: { body: image, contentType: "image/png" },
    });
    await orchestrator.render({
      ...common,
      settings: { ...defaultPostImageSettings, mode: "illustration" },
    });
    expect(calls[0].startsWith("edit:")).toBe(true);
    expect(calls[1].startsWith("generate:")).toBe(true);
  });

  test("orders saved direction, post context, accent, and one-off direction safely", () => {
    const prompt = buildPostImagePrompt({
      category: "feature",
      title: "Faster checkout",
      summary: "Checkout now needs fewer steps.",
      instructions: "Use a low camera angle.",
      settings: {
        ...defaultPostImageSettings,
        mode: "illustration",
        defaultPrompt: "Use tactile paper.",
      },
    });
    expect(prompt.indexOf("Saved art direction")).toBeLessThan(
      prompt.indexOf("Post category"),
    );
    expect(prompt.indexOf("Post summary")).toBeLessThan(
      prompt.indexOf("Brand accent colour"),
    );
    expect(prompt.indexOf("Brand accent colour")).toBeLessThan(
      prompt.indexOf("One-off direction"),
    );
    expect(prompt).toContain("Do not include any words");
  });

  test("normalizes reference orientation, metadata, dimensions, and type", async () => {
    const normalized = await normalizeReferenceImage(await sourceImage());
    expect(normalized.contentType).toBe("image/webp");
    expect(await sharp(normalized.body).metadata()).toMatchObject({
      format: "webp",
      width: 64,
      height: 48,
    });
  });
});

describe("post image generation jobs", () => {
  test("claims a queued brand card and attaches the stored public image", async () => {
    const store = InMemoryStore.seeded();
    const objects = new Map<
      string,
      { body: Uint8Array; contentType: string }
    >();
    const assetStorage: AssetStorage = {
      putObject: async ({ key, body, contentType }) => {
        objects.set(key, { body, contentType });
      },
      getObject: async (key) => objects.get(key) ?? null,
    };
    await store.enqueuePostImageGeneration({
      workspaceId: "ws_acme",
      entryId: "entry_saved_filters",
    });
    const processed = await processPostImageGenerationJobs({
      assetStorage,
      now: new Date(Date.now() + 1_000),
      orchestrator: new PostImageOrchestrator({
        generatePostImage: async () => {
          throw new Error("Brand cards do not call AI");
        },
      }),
      recordAiUsage: async () => undefined,
      store,
    });
    expect(processed).toBe(1);
    expect(store.entries[0]).toMatchObject({
      imageGenerationStatus: null,
    });
    expect(store.entries[0].imageUrl).toMatch(
      /^\/api\/public\/workspaces\/ws_acme\/changelog-entries\/entry_saved_filters\/image\?v=[a-zA-Z0-9_-]+$/,
    );
    expect(
      objects.has(
        "workspaces/ws_acme/changelog-entries/entry_saved_filters/image",
      ),
    ).toBe(true);
  });

  test("does not claim queued work after a manual image wins", async () => {
    const store = InMemoryStore.seeded();
    await store.enqueuePostImageGeneration({
      workspaceId: "ws_acme",
      entryId: "entry_saved_filters",
    });
    await store.updateEntryImage({
      workspaceId: "ws_acme",
      entryId: "entry_saved_filters",
      imageUrl: "/manual.webp",
    });
    expect(
      await store.claimPostImageGenerationJobs({
        now: new Date().toISOString(),
        limit: 10,
      }),
    ).toEqual([]);
  });
});
