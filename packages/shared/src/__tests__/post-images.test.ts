import { describe, expect, test } from "bun:test";
import {
  defaultPostImageSettings,
  normalizePostImageSettings,
} from "../post-images";

describe("post image settings", () => {
  test("normalizes defaults and migrates the legacy enabled toggle", () => {
    expect(
      normalizePostImageSettings(undefined, { legacyEnabled: true }),
    ).toEqual({ ...defaultPostImageSettings, enabled: true });
    expect(normalizePostImageSettings({}).titleOverlay).toBe(true);
  });

  test("keeps valid choices and rejects malformed values", () => {
    expect(
      normalizePostImageSettings({
        enabled: true,
        mode: "illustration",
        accentColor: "#aabbcc",
        titleOverlay: false,
        backgroundPattern: "road",
        referenceAssetKey: " refs/master.webp ",
        illustrationStyle: "cut-paper",
        defaultPrompt: `  tactile paper ${"x".repeat(1_100)}  `,
      }),
    ).toMatchObject({
      enabled: true,
      mode: "illustration",
      accentColor: "#AABBCC",
      titleOverlay: false,
      backgroundPattern: "road",
      referenceAssetKey: "refs/master.webp",
      illustrationStyle: "cut-paper",
    });
    expect(
      normalizePostImageSettings({ accentColor: "green", mode: "unknown" }),
    ).toMatchObject({
      accentColor: defaultPostImageSettings.accentColor,
      mode: defaultPostImageSettings.mode,
    });
  });
});
