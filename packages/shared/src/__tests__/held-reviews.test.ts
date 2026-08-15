import { describe, expect, test } from "bun:test";
import {
  getHeldReviewDaysRemaining,
  getHeldReviewExpiry,
  getHeldReviewExpiryCutoff,
} from "../held-reviews";

describe("held review retention", () => {
  test("expires a held review 30 days after it was processed", () => {
    expect(getHeldReviewExpiry("2026-07-01T12:00:00.000Z")?.toISOString()).toBe(
      "2026-07-31T12:00:00.000Z",
    );
  });

  test("rounds the visible countdown up to whole days", () => {
    const processedAt = "2026-07-01T12:00:00.000Z";

    expect(
      getHeldReviewDaysRemaining(
        processedAt,
        new Date("2026-07-29T12:00:01.000Z"),
      ),
    ).toBe(2);
    expect(
      getHeldReviewDaysRemaining(
        processedAt,
        new Date("2026-07-31T12:00:00.000Z"),
      ),
    ).toBe(0);
  });

  test("calculates the matching deletion cutoff", () => {
    expect(
      getHeldReviewExpiryCutoff(
        new Date("2026-08-15T00:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-07-16T00:00:00.000Z");
  });
});
