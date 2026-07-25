import { describe, expect, test } from "bun:test";
import { symmetricDecrypt } from "better-auth/crypto";
import {
  encryptOAuthToken,
  isEncryptedOAuthToken,
} from "../scripts/encrypt-oauth-tokens";

const secret = "test-secret-that-is-at-least-32-characters";

describe("OAuth token encryption", () => {
  test("encrypts plaintext tokens using Better Auth's compatible envelope", async () => {
    const encrypted = await encryptOAuthToken("gho_plaintext-token", secret);

    expect(encrypted).not.toBeNull();
    expect(isEncryptedOAuthToken(encrypted ?? "")).toBe(true);
    expect(
      await symmetricDecrypt({ data: encrypted ?? "", key: secret }),
    ).toBe("gho_plaintext-token");
  });

  test("is idempotent for current and legacy encrypted values", async () => {
    const encrypted = await encryptOAuthToken("ghr_refresh-token", secret);

    expect(await encryptOAuthToken(encrypted, secret)).toBe(encrypted);
    expect(await encryptOAuthToken("aabbccdd", secret)).toBe("aabbccdd");
    expect(await encryptOAuthToken(null, secret)).toBeNull();
  });
});
