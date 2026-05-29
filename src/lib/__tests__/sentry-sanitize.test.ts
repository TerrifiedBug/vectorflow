import { describe, it, expect } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";

import {
  sanitizeSentryEvent,
  DENY_HEADERS,
  DENY_QUERY_KEYS,
  DENY_VALUE_KEYS,
} from "../sentry-sanitize";

function blankEvent(): ErrorEvent {
  return {} as ErrorEvent;
}

describe("sanitizeSentryEvent — request body", () => {
  it("redacts request.data regardless of content", () => {
    const e = blankEvent();
    e.request = { data: { password: "p@ssword", username: "u" } };
    const out = sanitizeSentryEvent(e);
    expect(out.request?.data).toBe("[REDACTED]");
  });

  it("leaves request.data unchanged when not present", () => {
    const e = blankEvent();
    e.request = { url: "https://x.local/path" };
    sanitizeSentryEvent(e);
    expect(e.request.data).toBeUndefined();
  });
});

describe("sanitizeSentryEvent — query string", () => {
  it("redacts denylisted keys in the query_string", () => {
    const e = blankEvent();
    e.request = {
      query_string:
        "?token=secret-value&keep=ok&access_token=jwt-stuff&code=abc",
    };
    sanitizeSentryEvent(e);
    const qs = e.request.query_string as string;
    expect(qs).toContain("token=[REDACTED]");
    expect(qs).toContain("access_token=[REDACTED]");
    expect(qs).toContain("code=[REDACTED]");
    expect(qs).toContain("keep=ok");
  });

  it("preserves the leading ? when present", () => {
    const e = blankEvent();
    e.request = { query_string: "?token=x" };
    sanitizeSentryEvent(e);
    expect(e.request.query_string).toBe("?token=[REDACTED]");
  });

  it("handles a no-prefix query_string", () => {
    const e = blankEvent();
    e.request = { query_string: "token=x&y=z" };
    sanitizeSentryEvent(e);
    expect(e.request.query_string).toBe("token=[REDACTED]&y=z");
  });

  it("scrubs object-shape query_string", () => {
    const e = blankEvent();
    // Some Sentry serialisations emit an object here.
    e.request = {
      query_string: { token: "sensitive", page: "1" },
    } as unknown as ErrorEvent["request"];
    sanitizeSentryEvent(e);
    expect(
      (e.request!.query_string as Record<string, unknown>).token,
    ).toBe("[REDACTED]");
    expect(
      (e.request!.query_string as Record<string, unknown>).page,
    ).toBe("1");
  });
});

describe("sanitizeSentryEvent — headers", () => {
  it("redacts denylisted headers (case-insensitive)", () => {
    const e = blankEvent();
    e.request = {
      headers: {
        Authorization: "Bearer eyJ",
        "x-api-key": "k-12345",
        "User-Agent": "Mozilla/5.0",
        "x-trpc-source": "client",
      },
    };
    sanitizeSentryEvent(e);
    const h = e.request.headers as Record<string, string>;
    expect(h.Authorization).toBe("[REDACTED]");
    expect(h["x-api-key"]).toBe("[REDACTED]");
    expect(h["x-trpc-source"]).toBe("[REDACTED]");
    expect(h["User-Agent"]).toBe("Mozilla/5.0");
  });

  it("denylist includes the cookie + stripe-signature families", () => {
    expect(DENY_HEADERS.has("cookie")).toBe(true);
    expect(DENY_HEADERS.has("set-cookie")).toBe(true);
    expect(DENY_HEADERS.has("stripe-signature")).toBe(true);
    expect(DENY_HEADERS.has("x-vf-csp-nonce")).toBe(true);
  });
});

describe("sanitizeSentryEvent — cookies", () => {
  it("redacts every value in event.request.cookies (session + csrf)", () => {
    const e = blankEvent();
    // Sentry's requestDataIntegration parses the Cookie header into this
    // separate field even after the Cookie header itself is dropped.
    e.request = {
      cookies: {
        "__Host-vf-session": "eyJ-live-session-jwe",
        "authjs.csrf-token": "csrf-value",
        "non-secret": "whatever",
      },
    } as unknown as ErrorEvent["request"];
    sanitizeSentryEvent(e);
    const c = e.request!.cookies as Record<string, string>;
    // No cookie value survives — names are kept for diagnostics.
    expect(c["__Host-vf-session"]).toBe("[REDACTED]");
    expect(c["authjs.csrf-token"]).toBe("[REDACTED]");
    expect(c["non-secret"]).toBe("[REDACTED]");
  });

  it("leaves cookies untouched when not present", () => {
    const e = blankEvent();
    e.request = { url: "https://x.local/path" };
    sanitizeSentryEvent(e);
    expect(e.request.cookies).toBeUndefined();
  });

  it("redacts the session cookie even when the Cookie header is also dropped", () => {
    const e = blankEvent();
    e.request = {
      headers: { cookie: "__Host-vf-session=eyJ-live" },
      cookies: { "__Host-vf-session": "eyJ-live" },
    } as unknown as ErrorEvent["request"];
    sanitizeSentryEvent(e);
    expect((e.request!.headers as Record<string, string>).cookie).toBe(
      "[REDACTED]",
    );
    expect(
      (e.request!.cookies as Record<string, string>)["__Host-vf-session"],
    ).toBe("[REDACTED]");
  });
});

describe("sanitizeSentryEvent — recursive value-key scrub", () => {
  it("redacts secret-shaped keys in event.extra", () => {
    const e = blankEvent();
    e.extra = {
      orgId: "org-a",
      apiKey: "k-1",
      nested: {
        password: "p",
        keep: "ok",
        deeper: { secret: "s", okay: 42 },
      },
    };
    sanitizeSentryEvent(e);
    expect((e.extra as Record<string, unknown>).orgId).toBe("org-a");
    expect((e.extra as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    const nested = (e.extra as Record<string, unknown>).nested as Record<
      string,
      unknown
    >;
    expect(nested.password).toBe("[REDACTED]");
    expect(nested.keep).toBe("ok");
    const deeper = nested.deeper as Record<string, unknown>;
    expect(deeper.secret).toBe("[REDACTED]");
    expect(deeper.okay).toBe(42);
  });

  it("redacts secret-shaped keys in tags and contexts", () => {
    const e = blankEvent();
    e.tags = { totpSecret: "t", orgSlug: "acme" };
    e.contexts = {
      auth: { sessionToken: "x", userId: "u" },
    } as unknown as ErrorEvent["contexts"];
    sanitizeSentryEvent(e);
    expect((e.tags as Record<string, unknown>).totpSecret).toBe(
      "[REDACTED]",
    );
    expect((e.tags as Record<string, unknown>).orgSlug).toBe("acme");
    expect(
      (
        (e.contexts as unknown as Record<string, Record<string, unknown>>)
          .auth.sessionToken
      ),
    ).toBe("[REDACTED]");
  });

  it("walks breadcrumbs and redacts their data fields", () => {
    const e = blankEvent();
    e.breadcrumbs = [
      {
        category: "fetch",
        message: "POST /api/secret",
        data: { token: "tok-x", url: "/api/secret" },
      },
    ];
    sanitizeSentryEvent(e);
    expect(e.breadcrumbs?.[0].data?.token).toBe("[REDACTED]");
    expect(e.breadcrumbs?.[0].data?.url).toBe("/api/secret");
  });

  it("matches key names case-insensitively", () => {
    const e = blankEvent();
    e.extra = {
      OrgId: "ok",
      TotpSecret: "s1",
      DATAKEYCIPHERTEXT: "s2",
    };
    sanitizeSentryEvent(e);
    const x = e.extra as Record<string, unknown>;
    expect(x.OrgId).toBe("ok");
    expect(x.TotpSecret).toBe("[REDACTED]");
    expect(x.DATAKEYCIPHERTEXT).toBe("[REDACTED]");
  });

  it("does not loop on a circular object reference", () => {
    const e = blankEvent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a: any = { name: "root", secret: "s" };
    a.self = a;
    e.extra = { a };
    expect(() => sanitizeSentryEvent(e)).not.toThrow();
    const extraA = (e.extra as Record<string, unknown>).a as Record<
      string,
      unknown
    >;
    expect(extraA.secret).toBe("[REDACTED]");
    expect(extraA.self).toBe("[CIRCULAR]");
  });

  it("denylist covers crypto + tenancy + auth values", () => {
    for (const k of [
      "totpsecret",
      "datakeyciphertext",
      "stripesigningsecret",
      "oidcclientsecret",
      "magiclinktoken",
      "tokenhash",
      "encryptedvalue",
      "gitwebhooksecret",
    ]) {
      expect(DENY_VALUE_KEYS.has(k)).toBe(true);
    }
  });

  it("DENY_QUERY_KEYS covers the auth + OIDC + magic-link token families", () => {
    for (const k of [
      "token",
      "code",
      "access_token",
      "refresh_token",
      "id_token",
      "csrfToken",
    ]) {
      expect(DENY_QUERY_KEYS.has(k.toLowerCase())).toBe(true);
    }
  });
});

describe("sanitizeSentryEvent — full event", () => {
  it("redacts request body + headers + query + extra all in one pass", () => {
    const e = blankEvent();
    e.request = {
      url: "https://deployment.local/api/secret?token=tok&keep=ok",
      data: { secret: "x" },
      headers: { Authorization: "Bearer eyJ", "User-Agent": "ua" },
      query_string: "token=tok&keep=ok",
    };
    e.extra = { password: "p", orgId: "org-a" };
    sanitizeSentryEvent(e);

    expect(e.request?.data).toBe("[REDACTED]");
    expect((e.request?.headers as Record<string, string>).Authorization).toBe(
      "[REDACTED]",
    );
    expect((e.request?.headers as Record<string, string>)["User-Agent"]).toBe(
      "ua",
    );
    expect(e.request?.query_string).toBe(
      "token=[REDACTED]&keep=ok",
    );
    expect((e.extra as Record<string, unknown>).password).toBe("[REDACTED]");
    expect((e.extra as Record<string, unknown>).orgId).toBe("org-a");
  });
});
