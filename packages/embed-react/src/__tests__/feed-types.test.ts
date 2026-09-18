import { describe, expect, test } from "bun:test";
import type {
  PublicChangelog as SharedPublicChangelog,
  PublicFeed as SharedPublicFeed,
  PublicFeedEntry as SharedPublicFeedEntry,
} from "@cooee/shared";
import type {
  PublicChangelog,
  PublicFeed,
  PublicFeedEntry,
} from "../feed-types";

// Mutual assignability: resolves to true only when A and B are structurally
// interchangeable, so a drift in either direction breaks typecheck.
type Mutual<A, B> = A extends B ? (B extends A ? true : never) : never;

const feedParity: Mutual<PublicFeed, SharedPublicFeed> = true;
const entryParity: Mutual<PublicFeedEntry, SharedPublicFeedEntry> = true;
const changelogParity: Mutual<PublicChangelog, SharedPublicChangelog> = true;

describe("published feed types", () => {
  test("stay in sync with @cooee/shared", () => {
    expect(feedParity).toBe(true);
    expect(entryParity).toBe(true);
    expect(changelogParity).toBe(true);
  });
});
