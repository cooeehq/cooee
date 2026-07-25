import { describe, expect, test } from "bun:test";
import { signPayload, verifyGitHubSignature } from "../services/github";

describe("webhook signatures", () => {
  test("verifies GitHub sha256 webhook signatures", async () => {
    const payload = JSON.stringify({ action: "closed" });
    const signature = await signPayload(payload, "top-secret");

    expect(await verifyGitHubSignature({ payload, signature, secret: "top-secret" })).toBe(true);
    expect(await verifyGitHubSignature({ payload, signature, secret: "wrong-secret" })).toBe(false);
  });
});
