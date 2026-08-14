import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("shadcn Input wrapper", () => {
  test("bridges Base UI value changes to existing React onChange handlers", () => {
    const source = readFileSync(
      new URL("../components/ui/input.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("onValueChange");
    expect(source).toContain("eventDetails.event");
    expect(source).toContain("onChange?.(");
  });

  test("matches the default shadcn select trigger sizing", () => {
    const source = readFileSync(
      new URL("../components/ui/input.tsx", import.meta.url),
      "utf8",
    );
    const selectSource = readFileSync(
      new URL("../components/ui/select.tsx", import.meta.url),
      "utf8",
    );

    expect(selectSource).toContain("data-[size=default]:h-8");
    expect(source).toContain("h-8");
    expect(source).not.toContain("h-10");
    expect(source).toContain("rounded-lg");
    expect(source).toContain("border");
    expect(source).toContain("border-input");
    expect(source).toContain("bg-transparent");
    expect(source).toContain("px-2.5");
    expect(source).toContain("py-1");
    expect(source).toContain("file:h-6");
    expect(source).toContain("disabled:bg-input/50");
    expect(source).toContain("aria-invalid:border-destructive");
    expect(source).toContain("dark:aria-invalid:border-destructive/50");
    expect(source).toContain("focus-visible:ring-3");
  });

  test("keeps portaled select popups interactive inside drawer body locks", () => {
    const selectSource = readFileSync(
      new URL("../components/ui/select.tsx", import.meta.url),
      "utf8",
    );

    expect(selectSource).toContain(
      'className="pointer-events-auto isolate z-50"',
    );
    expect(selectSource).toContain(
      '"pointer-events-auto relative isolate z-50',
    );
  });

  test("styles Base UI select highlighted items for pointer hover", () => {
    const selectSource = readFileSync(
      new URL("../components/ui/select.tsx", import.meta.url),
      "utf8",
    );

    expect(selectSource).toContain("data-highlighted:bg-accent");
    expect(selectSource).toContain("data-highlighted:text-accent-foreground");
    expect(selectSource).toContain(
      "data-highlighted:**:text-accent-foreground",
    );
  });

  test("uses Base UI toggle pressed state instead of Radix state selectors", () => {
    const toggleSource = readFileSync(
      new URL("../components/ui/toggle.tsx", import.meta.url),
      "utf8",
    );

    expect(toggleSource).toContain("data-pressed:bg-muted");
    expect(toggleSource).not.toContain("data-[state=on]");
  });
});
