import { describe, expect, test } from "bun:test";
import { filterPublishablePullRequests, sanitizePullRequest } from "../privacy";
import type { PullRequestMetadata } from "../types";

const basePr: PullRequestMetadata = {
  id: "pr_1",
  number: 42,
  title: "Add saved filters",
  body: "Customers can save a filter and reuse it later.",
  labels: ["feature"],
  mergedAt: "2026-06-05T03:15:00.000Z",
  url: "https://github.com/acme/app/pull/42?secret=token",
  repository: "acme/app",
};

describe("privacy controls", () => {
  test("filters skipped, internal, and security labeled pull requests", () => {
    const result = filterPublishablePullRequests(
      [
        basePr,
        { ...basePr, id: "pr_2", labels: ["cooee:skip"] },
        { ...basePr, id: "pr_3", labels: ["cooee:internal"] },
        { ...basePr, id: "pr_4", labels: ["security"] },
      ],
      {
        skipLabels: ["cooee:skip", "cooee:internal"],
        sensitiveLabels: ["security"],
      },
    );

    expect(result.publishable.map((pr) => pr.id)).toEqual(["pr_1"]);
    expect(result.held.map((item) => item.pr.id)).toEqual([
      "pr_2",
      "pr_3",
      "pr_4",
    ]);
    expect(result.held.map((item) => item.reason)).toEqual([
      "skip-label",
      "skip-label",
      "sensitive-label",
    ]);
    expect(result.held.map((item) => item.matchedLabel)).toEqual([
      "cooee:skip",
      "cooee:internal",
      "security",
    ]);
  });

  test("sanitizes code, logs, query strings, authors, and secret-like values", () => {
    const sanitized = sanitizePullRequest({
      ...basePr,
      author: "octocat",
      body: [
        "Fixes login for EU users.",
        "```ts",
        "const token = 'abc123'",
        "```",
        "DEBUG request Authorization: Bearer super-secret-token",
        "DATABASE_URL=postgres://user:pass@example.com/db",
        "See https://example.com/path?api_key=123",
      ].join("\n"),
    });

    expect((sanitized as { author?: string }).author).toBeUndefined();
    expect(sanitized.url).toBe("https://github.com/acme/app/pull/42");
    expect(sanitized.body).toContain("[code removed]");
    expect(sanitized.body).toContain("[log removed]");
    expect(sanitized.body).toContain("DATABASE_URL=[redacted]");
    expect(sanitized.body).toContain("https://example.com/path");
    expect(sanitized.body).not.toContain("super-secret-token");
    expect(sanitized.body).not.toContain("api_key=123");
  });

  test("holds pull requests that expose global addresses", () => {
    const result = filterPublishablePullRequests(
      [
        {
          ...basePr,
          id: "pr_address_1",
          title: "Strip Australia suffixes from planned AU suggest searches",
          body: "Planned AU suggest searches now drop trailing AU or Australia country suffixes, so searches like 28 JERSEY ROAD BAYSWATER VIC 3153 AUSTRALIA behave the same as the address without the country suffix.",
        },
        {
          ...basePr,
          id: "pr_address_2",
          title: "Preserve slash-unit query behavior",
          body: "Addresses that use slash-unit formatting, such as 18/157 GLADSTONE STREET FYSHWICK ACT 2911 AUSTRALIA, continue to search correctly without losing the unit portion.",
        },
        {
          ...basePr,
          id: "pr_address_3",
          title: "Improve US delivery validation",
          body: "Delivery validation now accepts addresses like 1600 Pennsylvania Avenue NW, Washington, DC 20500 without stripping directional suffixes.",
        },
        {
          ...basePr,
          id: "pr_address_4",
          title: "Support UK postcode lookups",
          body: "Lookup examples such as 10 Downing Street, London SW1A 2AA now normalize with the same parser as other regions.",
        },
        {
          ...basePr,
          id: "pr_address_5",
          title: "Handle PO boxes",
          body: "Shipment forms now preserve P.O. Box 123, Berlin 10115 for carriers that require mailing addresses.",
        },
      ],
      {
        skipLabels: ["cooee:skip", "cooee:internal"],
        sensitiveLabels: ["security"],
      },
    );

    expect(result.publishable).toEqual([]);
    expect(result.held.map((item) => item.pr.id)).toEqual([
      "pr_address_1",
      "pr_address_2",
      "pr_address_3",
      "pr_address_4",
      "pr_address_5",
    ]);
    expect(result.held.map((item) => item.reason)).toEqual([
      "sensitive-content",
      "sensitive-content",
      "sensitive-content",
      "sensitive-content",
      "sensitive-content",
    ]);
  });

  test("holds pull requests that expose personally identifiable details", () => {
    const result = filterPublishablePullRequests(
      [
        {
          ...basePr,
          id: "pr_email",
          title: "Improve owner lookup",
          body: "The support tool can now find jane.customer@example.com in imported records.",
        },
        {
          ...basePr,
          id: "pr_phone",
          title: "Normalize contact phone inputs",
          body: "Phone parsing now accepts +1 (415) 555-0199 and stores the canonical value.",
        },
        {
          ...basePr,
          id: "pr_payment",
          title: "Mask card test fixtures",
          body: "The sample customer record used card 4242 4242 4242 4242 during QA.",
        },
        {
          ...basePr,
          id: "pr_identifier",
          title: "Redact tax identifiers",
          body: "Legacy exports included SSN 123-45-6789 in staff audit rows.",
        },
        {
          ...basePr,
          id: "pr_coordinates",
          title: "Tune map viewport",
          body: "The incident replay starts around 37.7749, -122.4194 for affected users.",
        },
      ],
      {
        skipLabels: ["cooee:skip", "cooee:internal"],
        sensitiveLabels: ["security"],
      },
    );

    expect(result.publishable).toEqual([]);
    expect(result.held.map((item) => item.pr.id)).toEqual([
      "pr_email",
      "pr_phone",
      "pr_payment",
      "pr_identifier",
      "pr_coordinates",
    ]);
    expect(result.held.map((item) => item.reason)).toEqual([
      "sensitive-content",
      "sensitive-content",
      "sensitive-content",
      "sensitive-content",
      "sensitive-content",
    ]);
  });
});
