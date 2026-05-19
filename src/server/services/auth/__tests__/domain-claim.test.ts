import { describe, it, expect } from "vitest";

import {
  DNS_VERIFICATION_PREFIX,
  TXT_VALUE_PREFIX,
  generateVerificationToken,
  normaliseDomain,
  verifyClaimViaDns,
  type DnsTxtResolver,
} from "../domain-claim";

describe("normaliseDomain", () => {
  it("lowercases, strips scheme, strips trailing dot", () => {
    expect(normaliseDomain("HTTPS://ACME.test.")).toBe("acme.test");
    expect(normaliseDomain("Acme.Test")).toBe("acme.test");
  });

  it("rejects domains with path, port, whitespace, or single label", () => {
    for (const bad of [
      "acme.test/path",
      "acme.test:8080",
      "acme test",
      "single",
      "",
      "..acme.test",
    ]) {
      expect(() => normaliseDomain(bad)).toThrow();
    }
  });

  it("rejects oversized DNS labels", () => {
    const longLabel = "a".repeat(64);
    expect(() => normaliseDomain(`${longLabel}.test`)).toThrow();
  });

  it("punycodes IDN domains before ASCII label validation", () => {
    // Codex P2 regression — prior order ran the ASCII regex BEFORE
    // punycoding, so legitimate IDN inputs like `café.com` were
    // rejected on the first non-ASCII label instead of being
    // normalised to their `xn--` form.
    expect(normaliseDomain("café.com")).toBe("xn--caf-dma.com");
    expect(normaliseDomain("CAFÉ.COM")).toBe("xn--caf-dma.com");
    expect(normaliseDomain("münchen.de")).toBe("xn--mnchen-3ya.de");
  });
});

describe("generateVerificationToken", () => {
  it("emits 32 base32 lowercase characters", () => {
    for (let i = 0; i < 10; i++) {
      const t = generateVerificationToken();
      expect(t).toMatch(/^[a-z2-7]{32}$/);
    }
  });

  it("does not collide across many invocations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateVerificationToken());
    expect(seen.size).toBe(1000);
  });
});

describe("verifyClaimViaDns", () => {
  function stub(records: string[][] | Error): DnsTxtResolver {
    return {
      resolveTxt: async (_h: string) => {
        if (records instanceof Error) throw records;
        return records;
      },
    };
  }

  it("returns ok=true on exact match", async () => {
    const r = await verifyClaimViaDns(
      { domain: "acme.test", verificationToken: "tok-abc" },
      stub([[`${TXT_VALUE_PREFIX}tok-abc`]]),
    );
    expect(r).toEqual({ ok: true });
  });

  it("matches across multi-chunk TXT records (joined)", async () => {
    const r = await verifyClaimViaDns(
      { domain: "acme.test", verificationToken: "tok-abc" },
      stub([[`${TXT_VALUE_PREFIX}tok-`, "abc"]]),
    );
    expect(r).toEqual({ ok: true });
  });

  it("returns ok=false on value mismatch", async () => {
    const r = await verifyClaimViaDns(
      { domain: "acme.test", verificationToken: "tok-abc" },
      stub([["vf-verify=different"]]),
    );
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/none match/);
  });

  it("maps ENOTFOUND/ENODATA to NXDOMAIN error string", async () => {
    const r = await verifyClaimViaDns(
      { domain: "acme.test", verificationToken: "tok-abc" },
      stub(Object.assign(new Error("nope"), { code: "ENOTFOUND" })),
    );
    expect((r as { error: string }).error).toMatch(/NXDOMAIN/);
  });

  it("maps ESERVFAIL to a transient-error message", async () => {
    const r = await verifyClaimViaDns(
      { domain: "acme.test", verificationToken: "tok-abc" },
      stub(Object.assign(new Error("nope"), { code: "ESERVFAIL" })),
    );
    expect((r as { error: string }).error).toMatch(/SERVFAIL/);
  });

  it("returns ok=false when no TXT records are returned at all", async () => {
    const r = await verifyClaimViaDns(
      { domain: "acme.test", verificationToken: "tok-abc" },
      stub([]),
    );
    expect((r as { error: string }).error).toMatch(/No TXT records/);
  });

  it("queries the correct host (`_vectorflow.<domain>`)", async () => {
    let calledWith = "";
    const resolver: DnsTxtResolver = {
      resolveTxt: async (h) => {
        calledWith = h;
        return [["vf-verify=tok-abc"]];
      },
    };
    await verifyClaimViaDns(
      { domain: "acme.test", verificationToken: "tok-abc" },
      resolver,
    );
    expect(calledWith).toBe(`${DNS_VERIFICATION_PREFIX}.acme.test`);
  });
});
