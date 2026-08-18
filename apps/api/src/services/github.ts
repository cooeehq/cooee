import { createSign } from "node:crypto";
import type { PullRequestMetadata } from "@cooee/shared";
import type { RuntimeConfig } from "../config";
import type { UpsertGitHubRepositoryInput } from "../store/types";

export type SyncedGitHubInstallation = {
  installationId: number;
  accountLogin: string;
  accountType: string;
  suspendedAt: string | null;
};

export type SyncedGitHubConnection = {
  installation: SyncedGitHubInstallation;
  repositories: Array<
    Omit<UpsertGitHubRepositoryInput, "workspaceId" | "githubInstallationId">
  >;
};

export type GitHubReleaseMetadata = {
  tagName: string;
  publishedAt: string;
};

export type GitHubAppClient = {
  syncInstallation(installationId: number): Promise<SyncedGitHubConnection>;
  getRepositoryReadme?(input: {
    installationId: number;
    owner: string;
    repo: string;
  }): Promise<string | null>;
  listMergedPullRequests(input: {
    installationId: number;
    owner: string;
    repo: string;
    since: string;
    until: string;
  }): Promise<PullRequestMetadata[]>;
  listPublishedReleases?(input: {
    installationId: number;
    owner: string;
    repo: string;
    since: string;
    until: string;
  }): Promise<GitHubReleaseMetadata[]>;
};

export async function signPayload(
  payload: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return `sha256=${toHex(signature)}`;
}

export async function verifyGitHubSignature(input: {
  payload: string;
  signature: string | null;
  secret: string;
}): Promise<boolean> {
  if (!input.signature?.startsWith("sha256=")) {
    return false;
  }

  const expected = await signPayload(input.payload, input.secret);
  return timingSafeEqual(expected, input.signature);
}

export function isGitHubAppConfigured(config: RuntimeConfig): boolean {
  return Boolean(
    config.githubAppId && config.githubAppPrivateKey && config.githubAppSlug,
  );
}

export function getGitHubAppInstallUrl(config: RuntimeConfig): string | null {
  if (!config.githubAppSlug) {
    return null;
  }

  return `https://github.com/apps/${encodeURIComponent(config.githubAppSlug)}/installations/new`;
}

export function createGitHubAppClient(
  config: RuntimeConfig,
  fetchImpl: typeof fetch = fetch,
): GitHubAppClient {
  function createAppJwt(): string {
    if (!config.githubAppId || !config.githubAppPrivateKey) {
      throw new Error(
        "GitHub App ID and private key are required to sync installations.",
      );
    }

    return createGitHubAppJwt({
      appId: config.githubAppId,
      privateKey: config.githubAppPrivateKey,
    });
  }

  return {
    async syncInstallation(
      installationId: number,
    ): Promise<SyncedGitHubConnection> {
      const jwt = createAppJwt();

      const installation = await githubJson<GitHubInstallationResponse>(
        `https://api.github.com/app/installations/${installationId}`,
        {
          fetchImpl,
          headers: {
            authorization: `Bearer ${jwt}`,
          },
        },
      );
      const token = await githubJson<{ token: string }>(
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        {
          fetchImpl,
          method: "POST",
          headers: {
            authorization: `Bearer ${jwt}`,
          },
        },
      );
      const repositories = await listInstallationRepositories({
        fetchImpl,
        token: token.token,
      });

      return {
        installation: {
          installationId,
          accountLogin: installation.account.login,
          accountType: installation.account.type,
          suspendedAt: installation.suspended_at,
        },
        repositories: repositories.map((repository) => ({
          owner: repository.owner.login,
          name: repository.name,
          fullName: repository.full_name,
          private: repository.private,
        })),
      };
    },

    async listMergedPullRequests(input): Promise<PullRequestMetadata[]> {
      const jwt = createAppJwt();
      const token = await createInstallationToken({
        fetchImpl,
        installationId: input.installationId,
        jwt,
      });
      const pullRequests = await listMergedPullRequests({
        fetchImpl,
        token,
        ...input,
      });

      return pullRequests.map((pullRequest) => ({
        id: `github_${pullRequest.id}`,
        number: pullRequest.number,
        title: pullRequest.title,
        body: pullRequest.body ?? "",
        labels: pullRequest.labels.map((label) => label.name),
        mergedAt: pullRequest.merged_at,
        url: stripUrlQuery(pullRequest.html_url),
        repository: `${input.owner}/${input.repo}`,
        author: pullRequest.user?.login,
      }));
    },

    async listPublishedReleases(input): Promise<GitHubReleaseMetadata[]> {
      const jwt = createAppJwt();
      const token = await createInstallationToken({
        fetchImpl,
        installationId: input.installationId,
        jwt,
      });
      const releases = await listPublishedReleases({
        fetchImpl,
        token,
        ...input,
      });

      return releases.map((release) => ({
        tagName: release.tag_name,
        publishedAt: release.published_at,
      }));
    },

    async getRepositoryReadme(input): Promise<string | null> {
      const jwt = createAppJwt();
      const token = await createInstallationToken({
        fetchImpl,
        installationId: input.installationId,
        jwt,
      });
      const readme = await githubJson<GitHubReadmeResponse>(
        `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/readme`,
        {
          fetchImpl,
          headers: {
            authorization: `Bearer ${token}`,
          },
        },
      );

      if (readme.encoding !== "base64" || !readme.content) {
        return null;
      }

      return decodeBase64Utf8(readme.content);
    },
  };
}

export function createGitHubAppJwt({
  appId,
  privateKey,
  now = new Date(),
}: {
  appId: string;
  privateKey: string;
  now?: Date;
}): string {
  const issuedAt = Math.floor(now.getTime() / 1000) - 60;
  const expiresAt = issuedAt + 600;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: issuedAt,
      exp: expiresAt,
      iss: appId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(normalizePrivateKey(privateKey));

  return `${signingInput}.${base64Url(signature)}`;
}

type GitHubInstallationResponse = {
  id: number;
  account: {
    login: string;
    type: string;
  };
  suspended_at: string | null;
};

type GitHubRepositoryResponse = {
  name: string;
  full_name: string;
  private: boolean;
  owner: {
    login: string;
  };
};

type GitHubReadmeResponse = {
  content?: string;
  encoding?: string;
};

type GitHubPullRequestResponse = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  merged_at: string | null;
  user: {
    login: string;
  } | null;
  labels: Array<{
    name: string;
  }>;
};

type GitHubReleaseResponse = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
};

async function listInstallationRepositories({
  fetchImpl,
  token,
}: {
  fetchImpl: typeof fetch;
  token: string;
}): Promise<GitHubRepositoryResponse[]> {
  const repositories: GitHubRepositoryResponse[] = [];
  let page = 1;

  while (true) {
    const body = await githubJson<{
      repositories: GitHubRepositoryResponse[];
      total_count: number;
    }>(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      {
        fetchImpl,
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    repositories.push(...body.repositories);

    if (
      repositories.length >= body.total_count ||
      body.repositories.length < 100
    ) {
      break;
    }

    page += 1;
  }

  return repositories;
}

async function createInstallationToken({
  fetchImpl,
  installationId,
  jwt,
}: {
  fetchImpl: typeof fetch;
  installationId: number;
  jwt: string;
}): Promise<string> {
  const token = await githubJson<{ token: string }>(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      fetchImpl,
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
      },
    },
  );

  return token.token;
}

async function listMergedPullRequests({
  fetchImpl,
  owner,
  repo,
  since,
  token,
  until,
}: {
  fetchImpl: typeof fetch;
  owner: string;
  repo: string;
  since: string;
  token: string;
  until: string;
}): Promise<Array<GitHubPullRequestResponse & { merged_at: string }>> {
  const pullRequests: Array<GitHubPullRequestResponse & { merged_at: string }> =
    [];
  let page = 1;

  while (true) {
    const body = await githubJson<GitHubPullRequestResponse[]>(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
      {
        fetchImpl,
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    for (const pullRequest of body) {
      if (!pullRequest.merged_at) {
        continue;
      }

      if (pullRequest.merged_at >= since && pullRequest.merged_at < until) {
        pullRequests.push({
          ...pullRequest,
          merged_at: pullRequest.merged_at,
        });
      }
    }

    if (
      body.length < 100 ||
      body.some(
        (pullRequest) => pullRequest.merged_at && pullRequest.merged_at < since,
      )
    ) {
      break;
    }

    page += 1;
  }

  return pullRequests.sort((left, right) =>
    left.merged_at.localeCompare(right.merged_at),
  );
}

async function listPublishedReleases({
  fetchImpl,
  owner,
  repo,
  since,
  token,
  until,
}: {
  fetchImpl: typeof fetch;
  owner: string;
  repo: string;
  since: string;
  token: string;
  until: string;
}): Promise<Array<GitHubReleaseResponse & { published_at: string }>> {
  const releases: Array<GitHubReleaseResponse & { published_at: string }> = [];
  let page = 1;

  while (true) {
    const body = await githubJson<GitHubReleaseResponse[]>(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=100&page=${page}`,
      {
        fetchImpl,
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    for (const release of body) {
      if (
        release.draft ||
        release.prerelease ||
        !release.published_at ||
        !isStableSemverTag(release.tag_name)
      ) {
        continue;
      }

      if (release.published_at >= since && release.published_at < until) {
        releases.push({
          ...release,
          published_at: release.published_at,
        });
      }
    }

    if (
      body.length < 100 ||
      body.some(
        (release) =>
          release.published_at !== null && release.published_at < since,
      )
    ) {
      break;
    }

    page += 1;
  }

  return releases.sort((left, right) =>
    left.published_at.localeCompare(right.published_at),
  );
}

function isStableSemverTag(value: string): boolean {
  return /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    value,
  );
}

async function githubJson<T>(
  url: string,
  input: {
    fetchImpl: typeof fetch;
    method?: string;
    headers: Record<string, string>;
  },
): Promise<T> {
  const response = await input.fetchImpl(url, {
    method: input.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "cooee",
      ...input.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `GitHub API request failed with ${response.status}${body ? `: ${body}` : ""}`,
    );
  }

  return (await response.json()) as T;
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.replaceAll("\\n", "\n");
}

function stripUrlQuery(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split("?")[0];
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);

  if (left.byteLength !== right.byteLength) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= left[index] ^ right[index];
  }

  return diff === 0;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
