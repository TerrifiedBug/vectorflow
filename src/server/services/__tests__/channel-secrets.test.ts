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

describe("encrypt+decrypt round trip", () => {
  it.each([
    ["webhook", { url: "https://x.test/h", hmacSecret: "s1", headers: { Authorization: "Bearer abc" } }],
    ["slack",     { webhookUrl: "https://hooks.slack.com/services/T/B/XYZ" }],
    ["pagerduty", { integrationKey: "ROUTING-KEY-123", severityMap: { error: "warning" } }],
    ["email",     { smtpHost: "smtp.x", smtpUser: "u", smtpPass: "p", recipients: ["a@b"] }],
  ])("round-trips %s", (type, plain) => {
    const enc = encryptChannelConfig(type, plain);
    const dec = decryptChannelConfig(type, enc);
    expect(dec).toEqual(plain);
  });
});

describe("idempotency", () => {
  it("does not re-encrypt already v2-prefixed values", () => {
    const once  = encryptChannelConfig("webhook", { hmacSecret: "raw" });
    const twice = encryptChannelConfig("webhook", once);
    expect(twice.hmacSecret).toBe(once.hmacSecret);
  });

  it("decrypt is no-op on plaintext", () => {
    const out = decryptChannelConfig("webhook", { hmacSecret: "plain" });
    expect(out.hmacSecret).toBe("plain");
  });
});

describe("unknown type", () => {
  it("returns config unchanged for unknown channel type", () => {
    const cfg = { foo: "bar" };
    expect(encryptChannelConfig("unknown", cfg)).toEqual(cfg);
    expect(decryptChannelConfig("unknown", cfg)).toEqual(cfg);
  });
});
