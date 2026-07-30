import { describe, expect, test } from "bun:test";
import { getPullRequestCategoryOverride } from "../categories";
import { buildPromptPayload, validateGeneratedEntry } from "../generation";
import type { PullRequestMetadata } from "../types";

const pr: PullRequestMetadata = {
  id: "pr_1",
  number: 42,
  title: "Add saved filters",
  body: "Users can save a filter view and reuse it later.",
  labels: ["feature"],
  mergedAt: "2026-06-05T03:15:00.000Z",
  url: "https://github.com/acme/app/pull/42",
  repository: "acme/app",
};

describe("AI generation contracts", () => {
  test("builds prompt payloads from sanitized PR metadata only", () => {
    const payload = buildPromptPayload([pr]);

    expect(payload.pullRequests[0]).toEqual({
      number: 42,
      title: "Add saved filters",
      body: "Users can save a filter view and reuse it later.",
      labels: ["feature"],
      mergedAt: "2026-06-05T03:15:00.000Z",
      repository: "acme/app",
      url: "https://github.com/acme/app/pull/42",
    });
  });

  test("marks feature post categories for fuller marketing copy by default", () => {
    const payload = buildPromptPayload([pr], {
      categoryDefinitions: [
        { id: "feature", label: "Feature", displayType: "post" },
        {
          id: "announcement",
          label: "Announcement",
          displayType: "post",
          marketingCopy: true,
        },
        {
          id: "fix",
          label: "Fix",
          displayType: "text",
          marketingCopy: true,
        },
        {
          id: "release-note",
          label: "Release note",
          displayType: "post",
          marketingCopy: false,
        },
      ],
    });

    expect(payload.categories).toEqual([
      {
        id: "feature",
        label: "Feature",
        displayType: "post",
        marketingCopy: true,
      },
      {
        id: "announcement",
        label: "Announcement",
        displayType: "post",
        marketingCopy: true,
      },
      {
        id: "fix",
        label: "Fix",
        displayType: "text",
        marketingCopy: false,
      },
      {
        id: "release-note",
        label: "Release note",
        displayType: "post",
        marketingCopy: false,
      },
    ]);
    expect(payload.instructions).toContain(
      "Write fuller feature-marketing posts for post display categories mapped to marketing copy: feature, announcement.",
    );
    expect(payload.instructions).not.toContain("fix,");
    expect(payload.instructions).not.toContain("release-note");
  });

  test("treats configured cooee category labels as authoritative", () => {
    const payload = buildPromptPayload(
      [{ ...pr, labels: ["backend", "Cooee:Feature"] }],
      {
        categoryDefinitions: [
          { id: "feature", label: "Feature", displayType: "post" },
          { id: "fix", label: "Fix", displayType: "text" },
        ],
      },
    );

    expect(payload.instructions).toContain("PR #42 must use feature");
    expect(
      getPullRequestCategoryOverride(
        ["cooee:release-note"],
        [
          {
            id: "release-note",
            label: "Release note",
            displayType: "callout",
          },
        ],
      ),
    ).toBe("release-note");
    expect(
      getPullRequestCategoryOverride(
        ["cooee:not-configured"],
        [{ id: "feature", label: "Feature", displayType: "post" }],
      ),
    ).toBeNull();
  });

  test("instructs generated copy to speak directly to the product user", () => {
    const payload = buildPromptPayload([pr], {
      aiAudience: "product-users",
      aiPersonality: "product-user",
    });

    expect(payload.instructions).toContain(
      "Address the product user directly as the reader.",
    );
    expect(payload.instructions).toContain(
      'Prefer second person wording such as "you" and "your".',
    );
    expect(payload.instructions).toContain(
      "Do not describe the reader in the third person as users, merchants, customers, store owners, teams",
    );
  });

  test("includes trimmed per-rewrite instructions when provided", () => {
    const payload = buildPromptPayload([pr], {
      rewriteInstructions:
        "  Lead with the customer outcome and keep the technical detail brief.  ",
    });

    expect(payload.rewriteInstructions).toBe(
      "Lead with the customer outcome and keep the technical detail brief.",
    );
  });

  test("includes structured repository feedback in the generation prompt", () => {
    const payload = buildPromptPayload([pr], {
      learnings: [
        {
          title: "Dependency refresh",
          summary: "Internal dependencies were updated.",
          category: "maintenance",
          note: "Dependency-only updates are not relevant.",
          feedbackKind: "dismissed",
          sourcePullRequests: [
            {
              number: 40,
              title: "Refresh dependencies",
              url: "https://github.com/acme/app/pull/40",
            },
          ],
        },
      ],
    });

    expect(payload.learnings?.[0]).toMatchObject({
      feedbackKind: "dismissed",
      note: "Dependency-only updates are not relevant.",
      sourcePullRequests: [{ number: 40, title: "Refresh dependencies" }],
    });
    expect(payload.instructions).toContain(
      "omit it from items and include its number in skippedPullRequestNumbers",
    );
  });

  test("suppresses backend library and service names for private repositories", () => {
    const payload = buildPromptPayload([pr], {
      aiAudience: "technical-users",
      aiPersonality: "technical",
      repositoryVisibility: "private",
    });

    expect(payload.instructions).toContain(
      "Do not name backend libraries, internal frameworks, third-party tools, or service providers",
    );
    expect(payload.instructions).toContain(
      "Private repositories must keep those implementation details unmentioned even for technical readers.",
    );
  });

  test("allows implementation details only for public technical writing", () => {
    const productPayload = buildPromptPayload([pr], {
      aiAudience: "product-users",
      aiPersonality: "product-user",
      repositoryVisibility: "public",
    });
    const technicalPayload = buildPromptPayload([pr], {
      aiAudience: "technical-users",
      aiPersonality: "technical",
      repositoryVisibility: "public",
    });

    expect(productPayload.instructions).toContain(
      "Do not name backend libraries, internal frameworks, third-party tools, or service providers",
    );
    expect(technicalPayload.instructions).toContain(
      "For public or open-source repositories with a technical writing style, implementation details may be mentioned only when they are material to the reader and present in the sanitized pull request metadata.",
    );
  });

  test("holds invalid or low-confidence model output", () => {
    expect(
      validateGeneratedEntry({
        title: "Saved filters",
        summary: "Users can save filters.",
        category: "feature",
        confidence: 0.71,
        sensitive: false,
      }),
    ).toEqual({ ok: false, reason: "low-confidence" });

    expect(
      validateGeneratedEntry({
        title: "Saved filters",
        summary: "Users can save filters.",
        category: "feature",
        confidence: 0.91,
        sensitive: true,
      }),
    ).toEqual({ ok: false, reason: "sensitive-output" });
  });

  test("holds generated PII without blocking safe product wording", () => {
    expect(
      validateGeneratedEntry({
        title: "Improve address matching",
        summary:
          "Address matching now handles examples such as 10 Downing Street, London SW1A 2AA.",
        category: "improvement",
        confidence: 0.91,
        sensitive: false,
      }),
    ).toEqual({ ok: false, reason: "sensitive-output" });

    expect(
      validateGeneratedEntry({
        title: "Password reset recovery",
        summary: "Password reset links recover more reliably.",
        category: "fix",
        confidence: 0.91,
        sensitive: false,
      }),
    ).toEqual({
      ok: true,
      entry: {
        title: "Password reset recovery",
        summary: "Password reset links recover more reliably.",
        category: "fix",
        confidence: 0.91,
      },
    });
  });

  test("validates structured change items for multi-change posts", () => {
    expect(
      validateGeneratedEntry({
        title: "Daily product updates",
        summary: "A set of customer-facing improvements shipped today.",
        category: "improvement",
        confidence: 0.91,
        sensitive: false,
        items: [
          {
            title: "Saved filters",
            summary: "Users can save filter views and return to them later.",
            category: "feature",
          },
          {
            title: "Login recovery",
            summary: "Expired sessions now recover without interrupting work.",
            category: "fix",
          },
        ],
      }),
    ).toEqual({
      ok: true,
      entry: {
        title: "Daily product updates",
        summary: "A set of customer-facing improvements shipped today.",
        category: "improvement",
        confidence: 0.91,
        items: [
          {
            title: "Saved filters",
            summary: "Users can save filter views and return to them later.",
            category: "feature",
          },
          {
            title: "Login recovery",
            summary: "Expired sessions now recover without interrupting work.",
            category: "fix",
          },
        ],
      },
    });
  });

  test("validates explicit learned exclusions", () => {
    expect(
      validateGeneratedEntry({
        title: "Customer-facing updates",
        summary: "Only customer-facing changes are included.",
        category: "improvement",
        confidence: 0.94,
        sensitive: false,
        items: [],
        skippedPullRequestNumbers: [40, 40, 41],
      }),
    ).toEqual({
      ok: true,
      entry: {
        title: "Customer-facing updates",
        summary: "Only customer-facing changes are included.",
        category: "improvement",
        confidence: 0.94,
        skippedPullRequestNumbers: [40, 41],
      },
    });
  });

  test("validates generated output against configured custom categories", () => {
    const validateWithCategories = validateGeneratedEntry as unknown as (
      candidate: Parameters<typeof validateGeneratedEntry>[0],
      options: {
        categoryDefinitions: Array<{
          id: string;
          label: string;
          displayType: "post" | "callout" | "text";
        }>;
      },
    ) => ReturnType<typeof validateGeneratedEntry>;
    const result = validateWithCategories(
      {
        title: "Partner launch",
        summary: "Partners can now publish launch notes from their workspace.",
        category: "announcement",
        confidence: 0.91,
        sensitive: false,
        items: [
          {
            title: "Partner launch",
            summary: "Launch notes now support partner-facing updates.",
            category: "announcement",
          },
        ],
      },
      {
        categoryDefinitions: [
          { id: "feature", label: "Feature", displayType: "post" },
          { id: "announcement", label: "Announcement", displayType: "callout" },
        ],
      },
    );

    expect(result).toEqual({
      ok: true,
      entry: {
        title: "Partner launch",
        summary: "Partners can now publish launch notes from their workspace.",
        category: "announcement",
        confidence: 0.91,
        items: [
          {
            title: "Partner launch",
            summary: "Launch notes now support partner-facing updates.",
            category: "announcement",
          },
        ],
      },
    });
  });
});
