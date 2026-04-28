import { describe, it, expect, beforeAll } from "vitest";
import { encryptChannelConfig, decryptChannelConfig } from "../channel-secrets";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-vitest-runs-only";
});

describe("encryptChannelConfig", () => {
  it("encrypts webhook hmacSecret as v2:-prefixed ciphertext", () => {
    const out = encryptChannelConfig("webhook", {
      url: "https://example.com/hook",
      hmacSecret: "raw-hmac-secret",
    });
    expect(out.url).toBe("https://example.com/hook");
    expect(typeof out.hmacSecret).toBe("string");
    expect(out.hmacSecret as string).toMatch(/^v2:/);
  });
});
