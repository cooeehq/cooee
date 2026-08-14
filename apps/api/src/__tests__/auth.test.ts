import { describe, expect, test } from "bun:test";
import {
  GITHUB_OAUTH_SCOPES,
  getGitHubContactEmail,
  getGitHubProfileEmail,
  listGitHubAccess,
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

  test("resolves repository-level access for every accessible installation", async () => {
    const urls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/user/installations?")) {
        return Response.json({ installations: [{ id: 12345 }] });
      }
      if (url.includes("/user/installations/12345/repositories?")) {
        return Response.json({
          repositories: [{ full_name: "Acme/App" }, { full_name: "acme/docs" }],
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    await expect(listGitHubAccess("github-token", fetcher)).resolves.toEqual({
      installationIds: [12345],
      repositoryFullNames: ["acme/app", "acme/docs"],
    });
    expect(urls).toHaveLength(2);
  });

  test("fails closed when repository-level GitHub access cannot be read", async () => {
    const fetcher = (async (input: string | URL | Request) =>
      String(input).includes("/user/installations?")
        ? Response.json({ installations: [{ id: 12345 }] })
        : new Response(null, { status: 403 })) as typeof fetch;

    await expect(listGitHubAccess("github-token", fetcher)).resolves.toBeNull();
  });
});
