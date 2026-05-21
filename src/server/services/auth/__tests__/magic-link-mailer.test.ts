import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendMagicLinkEmail } from "../magic-link-mailer";

const ENV_KEYS = [
  "NODE_ENV",
  "MAIL_TRANSPORT",
  "VF_MAGIC_LINK_TRANSPORT",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_SECURE",
  "MAIL_FROM",
  "SMTP_FROM",
] as const;

const ORIGINAL: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    ORIGINAL[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  const env = process.env as Record<string, string | undefined>;
  for (const key of ENV_KEYS) {
    if (ORIGINAL[key] === undefined) delete env[key];
    else env[key] = ORIGINAL[key];
  }
  vi.resetModules();
  vi.restoreAllMocks();
});

function args(overrides: Partial<{ email: string; redeemUrl: string; expiresAt: Date }> = {}) {
  return {
    email: overrides.email ?? "owner@example.test",
    redeemUrl: overrides.redeemUrl ?? "https://acme.example.test/api/auth/magic-link/redeem?token=abc",
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 600_000),
  };
}

describe("sendMagicLinkEmail", () => {
  it("returns ok=true and transport=log in DEV without SMTP", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    const result = await sendMagicLinkEmail(args());
    expect(result.ok).toBe(true);
    expect(result.transport).toBe("log");
  });

  it("returns ok=false and transport=unconfigured in PROD without SMTP", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const result = await sendMagicLinkEmail(args());
    expect(result.ok).toBe(false);
    expect(result.transport).toBe("unconfigured");
  });

  it("returns ok=true with transport=external when VF_MAGIC_LINK_TRANSPORT is set", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.VF_MAGIC_LINK_TRANSPORT = "sidecar";
    const result = await sendMagicLinkEmail(args());
    expect(result.ok).toBe(true);
    expect(result.transport).toBe("external");
  });

  it("returns ok=true with transport=noop when MAIL_TRANSPORT=noop", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.MAIL_TRANSPORT = "noop";
    const result = await sendMagicLinkEmail(args());
    expect(result.ok).toBe(true);
    expect(result.transport).toBe("noop");
  });

  it("delivers via SMTP when SMTP_HOST + SMTP_PORT are set", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.SMTP_HOST = "mailhog.local";
    process.env.SMTP_PORT = "1025";
    process.env.MAIL_FROM = "noreply@vectorflow.test";

    const sendMail = vi.fn().mockResolvedValue({ messageId: "<abc@vectorflow.test>" });
    const createTransport = vi.fn().mockReturnValue({ sendMail });
    vi.doMock("nodemailer", () => ({
      default: { createTransport },
      createTransport,
    }));

    // Re-require to pick up the doMock.
    const { sendMagicLinkEmail: send } = await import("../magic-link-mailer");
    const result = await send(args());

    expect(result.ok).toBe(true);
    expect(result.transport).toBe("smtp");
    expect(result.messageId).toBe("<abc@vectorflow.test>");
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "mailhog.local",
        port: 1025,
        secure: false,
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.test",
        from: "noreply@vectorflow.test",
        subject: expect.stringContaining("Sign in"),
      }),
    );
  });

  it("auto-derives secure=true on port 465", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.SMTP_HOST = "smtp.relay.test";
    process.env.SMTP_PORT = "465";

    const sendMail = vi.fn().mockResolvedValue({ messageId: "<id@host>" });
    const createTransport = vi.fn().mockReturnValue({ sendMail });
    vi.doMock("nodemailer", () => ({
      default: { createTransport },
      createTransport,
    }));

    const { sendMagicLinkEmail: send } = await import("../magic-link-mailer");
    await send(args());

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true }),
    );
  });

  it("returns ok=false with transport=smtp when send throws", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.SMTP_HOST = "smtp.broken.test";
    process.env.SMTP_PORT = "25";

    const sendMail = vi
      .fn()
      .mockRejectedValue(new Error("connection refused"));
    const createTransport = vi.fn().mockReturnValue({ sendMail });
    vi.doMock("nodemailer", () => ({
      default: { createTransport },
      createTransport,
    }));

    const { sendMagicLinkEmail: send } = await import("../magic-link-mailer");
    const result = await send(args());
    expect(result.ok).toBe(false);
    expect(result.transport).toBe("smtp");
    expect(result.error).toMatch(/connection refused/);
  });

  it("rejects an SMTP_PORT outside the valid TCP range", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.SMTP_HOST = "smtp.relay.test";
    process.env.SMTP_PORT = "99999";

    const result = await sendMagicLinkEmail(args());
    expect(result.ok).toBe(false);
    expect(result.transport).toBe("unconfigured");
  });
});
