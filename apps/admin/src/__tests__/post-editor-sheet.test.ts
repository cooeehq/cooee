import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("PostEditorSheet", () => {
  test("keeps text selection from starting a drawer drag", () => {
    const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const postEditorSheet = source.slice(
      source.indexOf("function PostEditorSheet("),
      source.indexOf("function SelectField("),
    );

    expect(postEditorSheet).toContain("data-vaul-no-drag");
  });
});
