import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Button sounds", () => {
  test("enables the press and release pair by default", () => {
    const source = readFileSync(
      new URL("../components/ui/button.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('play("press")');
    expect(source).toContain('play("release")');
    expect(source).toContain("onPointerDown?.(event)");
    expect(source).toContain("onPointerUp?.(event)");
  });

  test("can opt out of interaction sounds", () => {
    const source = readFileSync(
      new URL("../components/ui/button.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("sound = true");
    expect(source).toContain("if (sound && !event.defaultPrevented)");
  });
});
