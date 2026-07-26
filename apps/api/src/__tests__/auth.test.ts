import { describe, expect, test } from "bun:test";
import {
  GITHUB_OAUTH_SCOPES,
  getGitHubContactEmail,
  getGitHubProfileEmail,
} from "../auth";

describe("GitHub authentication", () => {
  test("keeps a GitHub profile email when one is available", () => {
    expect(
      getGitHubProfileEmail({ id: 12345, email: " owner@example.com " }),
    ).toBe("owner@example.com");
  });

  test("uses a stable non-deliverable email when GitHub keeps it private", () => {
    expect(getGitHubProfileEmail({ id: 12345, email: null })).toBe(
      "github-12345@auth.cooee.invalid",
    );
    expect(getGitHubProfileEmail({ id: 12345 })).toBe(
      "github-12345@auth.cooee.invalid",
    );
  });

  test("does not treat a synthesized GitHub email as a contact address", () => {
    expect(getGitHubContactEmail("github-12345@auth.cooee.invalid")).toBeNull();
    expect(getGitHubContactEmail(" owner@example.com ")).toBe(
      "owner@example.com",
    );
  });

  test("requests permission to discover accessible GitHub App installations", () => {
    expect(GITHUB_OAUTH_SCOPES).toContain("read:org");
  });
});
