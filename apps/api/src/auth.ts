import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "./db/client";
import { accounts, sessions, users, verifications } from "./db/schema";

export type AuthRuntime = {
  handler(request: Request): Promise<Response>;
  getSession(headers: Headers): Promise<AuthSession | null>;
  listAccessibleGitHubInstallationIds?(
    headers: Headers,
  ): Promise<number[] | null>;
  canAccessGitHubInstallation(
    headers: Headers,
    installationId: number,
  ): Promise<boolean>;
};

export type AuthSession = {
  user: { id: string; name: string; email: string | null };
};

export function getGitHubProfileEmail(profile: {
  id: string | number;
  email?: string | null;
}): string {
  return profile.email?.trim() || `github-${profile.id}@auth.cooee.invalid`;
}

export function getGitHubContactEmail(
  email: string | null | undefined,
): string | null {
  const normalizedEmail = email?.trim() || null;
  return normalizedEmail?.endsWith("@auth.cooee.invalid")
    ? null
    : normalizedEmail;
}

export function isGitHubOAuthConfigured(
  env: Record<string, string | undefined> = Bun.env,
): boolean {
  return Boolean(
    env.DATABASE_URL && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET,
  );
}

export function createAuth(
  env: Record<string, string | undefined> = Bun.env,
): AuthRuntime {
  const db = createDb(env.DATABASE_URL);
  const trustedClientIpHeader =
    env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase() ??
    (env.RAILWAY_PROJECT_ID ? "x-real-ip" : undefined);
  const trustedOrigins = Array.from(
    new Set(
      [
        env.APP_URL ?? "http://localhost:3000",
        env.BETTER_AUTH_URL,
        ...(env.NODE_ENV === "production" ? [] : ["http://localhost:5173"]),
      ].filter((origin): origin is string => Boolean(origin)),
    ),
  );

  const auth = betterAuth({
    appName: "Cooee",
    baseURL:
      env.BETTER_AUTH_URL ??
      env.APP_URL ??
      `http://localhost:${env.PORT ?? 3000}`,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
      camelCase: true,
    }),
    account: {
      encryptOAuthTokens: true,
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID ?? "",
        clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
        mapProfileToUser: (profile) => ({
          email: getGitHubProfileEmail(profile),
        }),
      },
    },
    trustedOrigins,
    advanced: {
      ...(trustedClientIpHeader
        ? {
            ipAddress: {
              ipAddressHeaders: [trustedClientIpHeader],
            },
          }
        : {}),
      useSecureCookies: (env.BETTER_AUTH_URL ?? env.APP_URL)?.startsWith(
        "https://",
      ),
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
    },
  });

  async function listAccessibleGitHubInstallationIds(
    headers: Headers,
  ): Promise<number[] | null> {
    try {
      const token = await auth.api.getAccessToken({
        body: { providerId: "github" },
        headers,
      });
      const installationIds = new Set<number>();
      let pageUrl: string | null =
        "https://api.github.com/user/installations?per_page=100";

      for (let page = 0; page < 10 && pageUrl; page += 1) {
        const response = await fetch(pageUrl, {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token.accessToken}`,
            "x-github-api-version": "2022-11-28",
          },
        });
        if (!response.ok) return null;
        const body = (await response.json()) as {
          installations?: Array<{ id?: number }>;
        };
        for (const installation of body.installations ?? []) {
          if (
            Number.isInteger(installation.id) &&
            (installation.id ?? 0) > 0
          ) {
            installationIds.add(installation.id as number);
          }
        }
        pageUrl = readNextLink(response.headers.get("link"));
      }

      return [...installationIds];
    } catch {
      return null;
    }
  }

  return {
    handler: auth.handler,
    async getSession(headers) {
      const session = await auth.api.getSession({ headers });
      return session
        ? {
            user: {
              id: session.user.id,
              name: session.user.name,
              email: getGitHubContactEmail(session.user.email),
            },
          }
        : null;
    },
    async listAccessibleGitHubInstallationIds(headers) {
      return listAccessibleGitHubInstallationIds(headers);
    },
    async canAccessGitHubInstallation(headers, installationId) {
      const installationIds =
        await listAccessibleGitHubInstallationIds(headers);
      return installationIds?.includes(installationId) ?? false;
    },
  };
}

function readNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const item of link.split(",")) {
    const match = item.match(/<([^>]+)>;\s*rel="next"/);
    if (match?.[1]?.startsWith("https://api.github.com/")) return match[1];
  }
  return null;
}
