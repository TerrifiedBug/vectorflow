import { describe, it, expect } from "vitest";
import { sanitizeInput, SENSITIVE_KEYS } from "../audit-sanitize";

describe("sanitizeInput", () => {
  it("redacts top-level sensitive keys", () => {
    const out = sanitizeInput({
      name: "alice",
      password: "p@ss",
      token: "abc",
    });
    expect(out).toEqual({
      name: "alice",
      password: "[REDACTED]",
      token: "[REDACTED]",
    });
  });

  it("redacts NotificationChannel config secret fields", () => {
    const out = sanitizeInput({
      name: "Slack ops",
      config: {
        webhookUrl: "https://hooks.slack.com/services/T0/B0/secret-token",
        hmacSecret: "shhh",
        smtpPass: "smtp-pw",
        integrationKey: "pd-routing-key",
      },
    });
    expect(out).toEqual({
      name: "Slack ops",
      config: {
        webhookUrl: "[REDACTED]",
        hmacSecret: "[REDACTED]",
        smtpPass: "[REDACTED]",
        integrationKey: "[REDACTED]",
      },
    });
  });

  it("recurses into nested objects and arrays", () => {
    const out = sanitizeInput({
      channels: [
        { name: "A", config: { hmacSecret: "x" } },
        { name: "B", config: { smtpPass: "y" } },
      ],
    });
    expect(out).toEqual({
      channels: [
        { name: "A", config: { hmacSecret: "[REDACTED]" } },
        { name: "B", config: { smtpPass: "[REDACTED]" } },
      ],
    });
  });

  it("passes through non-sensitive primitives unchanged", () => {
    const out = sanitizeInput({ id: "abc", count: 3, enabled: true });
    expect(out).toEqual({ id: "abc", count: 3, enabled: true });
  });

  it("handles null and undefined", () => {
    expect(sanitizeInput(null)).toBeNull();
    expect(sanitizeInput(undefined)).toBeUndefined();
  });

  it("includes the new channel-secret keys in SENSITIVE_KEYS", () => {
    expect(SENSITIVE_KEYS.has("hmacSecret")).toBe(true);
    expect(SENSITIVE_KEYS.has("smtpPass")).toBe(true);
    expect(SENSITIVE_KEYS.has("integrationKey")).toBe(true);
    expect(SENSITIVE_KEYS.has("webhookUrl")).toBe(true);
  });
});
