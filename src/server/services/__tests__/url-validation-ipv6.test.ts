import { describe, it, expect } from "vitest";
import { isPrivateIP } from "@/server/services/url-validation";

describe("isPrivateIP — cloud metadata IPs", () => {
  it("rejects AWS IMDS IPv4 (169.254.169.254)", () => {
    expect(isPrivateIP("169.254.169.254")).toBe(true);
  });

  it("rejects AWS IMDSv2 IPv6 (fd00:ec2::254)", () => {
    expect(isPrivateIP("fd00:ec2::254")).toBe(true);
  });

  it("rejects GCP metadata IPv6 (fd00:1::3)", () => {
    expect(isPrivateIP("fd00:1::3")).toBe(true);
  });

  it("rejects Azure metadata IPv4 (169.254.169.254 — shared)", () => {
    expect(isPrivateIP("169.254.169.254")).toBe(true);
  });
});

describe("isPrivateIP — IPv4-mapped IPv6 evasion", () => {
  it("rejects ::ffff:169.254.169.254 (mapped link-local metadata IP)", () => {
    expect(isPrivateIP("::ffff:169.254.169.254")).toBe(true);
  });

  it("rejects ::ffff:127.0.0.1 (mapped loopback)", () => {
    expect(isPrivateIP("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects ::ffff:10.0.0.1 (mapped RFC 1918)", () => {
    expect(isPrivateIP("::ffff:10.0.0.1")).toBe(true);
  });

  it("rejects ::ffff:192.168.1.1 (mapped RFC 1918)", () => {
    expect(isPrivateIP("::ffff:192.168.1.1")).toBe(true);
  });

  it("rejects ::ffff:172.20.0.1 (mapped RFC 1918 in 172.16/12)", () => {
    expect(isPrivateIP("::ffff:172.20.0.1")).toBe(true);
  });

  it("permits a public mapped IPv4 (would be useless but should not false-positive)", () => {
    expect(isPrivateIP("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("isPrivateIP — IPv6 tunneling/legacy prefixes", () => {
  it("rejects 6to4 prefix (2002::/16) entirely — embedded IPv4 may be private", () => {
    expect(isPrivateIP("2002:a9fe:a9fe::1")).toBe(true);
  });

  it("rejects Teredo (2001::/32)", () => {
    expect(isPrivateIP("2001:0:53aa:64c:14b:31f4:8d3f:cdfe")).toBe(true);
  });

  it("rejects deprecated site-local fec0::/10", () => {
    expect(isPrivateIP("fec0::1")).toBe(true);
  });
});

describe("isPrivateIP — already-covered cases stay rejected (no regression)", () => {
  it("loopback IPv4", () => {
    expect(isPrivateIP("127.0.0.1")).toBe(true);
  });
  it("loopback IPv6", () => {
    expect(isPrivateIP("::1")).toBe(true);
  });
  it("link-local IPv6 (fe80::)", () => {
    expect(isPrivateIP("fe80::1")).toBe(true);
  });
  it("unique-local IPv6 (fc00::)", () => {
    expect(isPrivateIP("fc00::1")).toBe(true);
  });
  it("0.0.0.0/8 (\"this\" network)", () => {
    expect(isPrivateIP("0.0.0.0")).toBe(true);
    expect(isPrivateIP("0.1.2.3")).toBe(true);
  });
});

describe("isPrivateIP — public IPs are NOT rejected", () => {
  it("public IPv4 (Cloudflare DNS)", () => {
    expect(isPrivateIP("1.1.1.1")).toBe(false);
  });
  it("public IPv4 (Google DNS)", () => {
    expect(isPrivateIP("8.8.8.8")).toBe(false);
  });
  it("public IPv6 (Cloudflare)", () => {
    expect(isPrivateIP("2606:4700:4700::1111")).toBe(false);
  });
  it("public IPv6 (Google)", () => {
    expect(isPrivateIP("2001:4860:4860::8888")).toBe(false);
  });
});

describe("isPrivateIP — Codex follow-ups: compressed Teredo + wider site-local", () => {
  it("rejects compressed Teredo (2001::1)", () => {
    expect(isPrivateIP("2001::1")).toBe(true);
  });

  it("rejects Teredo with explicit zero second hextet (2001:0:...)", () => {
    expect(isPrivateIP("2001:0:53aa:64c::1")).toBe(true);
  });

  it("does NOT reject 2001:db8:: (documentation block, outside /32)", () => {
    // 2001:db8::/32 is reserved for documentation but per RFC 3849 it's
    // not Teredo. Keep it permitted; that range is the legitimate
    // \"public\" prefix used in examples and won't be targeted in practice.
    expect(isPrivateIP("2001:db8::1")).toBe(false);
  });

  it("rejects wider site-local fec0::/10 (fed0::1)", () => {
    expect(isPrivateIP("fed0::1")).toBe(true);
  });

  it("rejects wider site-local fec0::/10 (feff::1)", () => {
    expect(isPrivateIP("feff::1")).toBe(true);
  });

  it("does NOT reject fe80:: (link-local handled by separate rule, but not site-local)", () => {
    // fe80::1 is link-local (rejected by the fe80 rule), but it's NOT
    // matched by the site-local rule.
    expect(isPrivateIP("fe80::1")).toBe(true); // rejected by link-local rule
  });

  it("does NOT reject fe00::1 (outside both link-local and site-local /10)", () => {
    expect(isPrivateIP("fe00::1")).toBe(false);
  });
});
