import { symmetricEncrypt } from "better-auth/crypto";
import postgres from "postgres";

type OAuthAccountRow = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
};

export function isEncryptedOAuthToken(value: string): boolean {
  return (
    value.startsWith("$ba$") ||
    (value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value))
  );
}

export async function encryptOAuthToken(
  value: string | null,
  secret: string,
): Promise<string | null> {
  if (!value || isEncryptedOAuthToken(value)) return value;
  return symmetricEncrypt({ data: value, key: secret });
}

export async function encryptStoredOAuthTokens({
  databaseUrl,
  secret,
}: {
  databaseUrl: string;
  secret: string;
}): Promise<{ accountsUpdated: number; tokensEncrypted: number }> {
  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
  }

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    return await sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext('cooee_encrypt_oauth_tokens'))`;
      const accounts = await transaction<OAuthAccountRow[]>`
        select id, access_token, refresh_token
        from accounts
        where access_token is not null or refresh_token is not null
        for update
      `;
      let accountsUpdated = 0;
      let tokensEncrypted = 0;

      for (const account of accounts) {
        const accessToken = await encryptOAuthToken(
          account.access_token,
          secret,
        );
        const refreshToken = await encryptOAuthToken(
          account.refresh_token,
          secret,
        );
        if (
          accessToken === account.access_token &&
          refreshToken === account.refresh_token
        ) {
          continue;
        }

        tokensEncrypted += Number(accessToken !== account.access_token);
        tokensEncrypted += Number(refreshToken !== account.refresh_token);
        accountsUpdated += 1;
        await transaction`
          update accounts
          set
            access_token = ${accessToken},
            refresh_token = ${refreshToken},
            updated_at = now()
          where id = ${account.id}
        `;
      }

      return { accountsUpdated, tokensEncrypted };
    });
  } finally {
    await sql.end();
  }
}

async function main() {
  const databaseUrl = Bun.env.DATABASE_URL;
  const secret = Bun.env.BETTER_AUTH_SECRET;
  if (!databaseUrl || !secret) {
    throw new Error("DATABASE_URL and BETTER_AUTH_SECRET are required.");
  }

  const result = await encryptStoredOAuthTokens({ databaseUrl, secret });
  console.log(
    `OAuth token encryption complete: ${result.accountsUpdated} account(s) updated, ${result.tokensEncrypted} token(s) encrypted.`,
  );
}

if (import.meta.main) {
  await main();
}
