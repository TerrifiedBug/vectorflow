import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dns/promises", () => ({
  default: {
    resolve4: vi.fn(),
    resolve6: vi.fn(),
  },
}));

import dns from "dns/promises";
import {
  isCloudStrictOutbound,
  validateOutboundUrl,
} from "@/server/services/url-validation";

const resolve4Mock = vi.mocked(dns.resolve4);
const resolve6Mock = vi.mocked(dns.resolve6);

describe("isCloudStrictOutbound", () => {
  const original = process.env.VF_CLOUD_STRICT_OUTBOUND;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.VF_CLOUD_STRICT_OUTBOUND;
    } else {
      process.env.VF_CLOUD_STRICT_OUTBOUND = original;
    }
  });

  it("returns false when env var is unset", () => {
    delete process.env.VF_CLOUD_STRICT_OUTBOUND;
    expect(isCloudStrictOutbound()).toBe(false);
  });

  it("returns false when env var is anything other than the string 'true'", () => {
    process.env.VF_CLOUD_STRICT_OUTBOUND = "1";
    expect(isCloudStrictOutbound()).toBe(false);
    process.env.VF_CLOUD_STRICT_OUTBOUND = "yes";
    expect(isCloudStrictOutbound()).toBe(false);
    process.env.VF_CLOUD_STRICT_OUTBOUND = "TRUE";
    expect(isCloudStrictOutbound()).toBe(false);
  });

  it("returns true when env var is the literal 'true'", () => {
    process.env.VF_CLOUD_STRICT_OUTBOUND = "true";
    expect(isCloudStrictOutbound()).toBe(true);
  });
});

describe("validateOutboundUrl", () => {
  const original = process.env.VF_CLOUD_STRICT_OUTBOUND;

  beforeEach(() => {
    resolve4Mock.mockReset();
    resolve6Mock.mockReset();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.VF_CLOUD_STRICT_OUTBOUND;
    } else {
      process.env.VF_CLOUD_STRICT_OUTBOUND = original;
    }
  });

  describe("with VF_CLOUD_STRICT_OUTBOUND unset (OSS default)", () => {
    beforeEach(() => {
      delete process.env.VF_CLOUD_STRICT_OUTBOUND;
    });

    it("is a no-op for localhost URLs (OSS users can target local services)", async () => {
      await expect(
        validateOutboundUrl("http://localhost:8080/api"),
      ).resolves.toBeUndefined();
      expect(resolve4Mock).not.toHaveBeenCalled();
      expect(resolve6Mock).not.toHaveBeenCalled();
    });

    it("is a no-op for RFC 1918 IP literals", async () => {
      await expect(
        validateOutboundUrl("http://10.0.0.1/health"),
      ).resolves.toBeUndefined();
      expect(resolve4Mock).not.toHaveBeenCalled();
    });

    it("validates anyway when opts.force is set", async () => {
      await expect(
        validateOutboundUrl("http://10.0.0.1/", { force: true }),
      ).rejects.toThrow("private or reserved IP");
    });
  });

  describe("with VF_CLOUD_STRICT_OUTBOUND=true", () => {
    beforeEach(() => {
      process.env.VF_CLOUD_STRICT_OUTBOUND = "true";
    });

    it("rejects http://localhost", async () => {
      await expect(
        validateOutboundUrl("http://localhost/"),
      ).rejects.toThrow("private or reserved IP");
    });

    it("rejects http://127.0.0.1", async () => {
      await expect(
        validateOutboundUrl("http://127.0.0.1/"),
      ).rejects.toThrow("private or reserved IP");
    });

    it("rejects the AWS IMDS IP literal", async () => {
      await expect(
        validateOutboundUrl("http://169.254.169.254/latest/meta-data/"),
      ).rejects.toThrow("private or reserved IP");
    });

    it("rejects RFC 1918 IPv4 literals", async () => {
      await expect(validateOutboundUrl("http://10.0.0.1/")).rejects.toThrow(
        "private or reserved IP",
      );
      await expect(
        validateOutboundUrl("http://192.168.1.1/"),
      ).rejects.toThrow("private or reserved IP");
      await expect(
        validateOutboundUrl("http://172.16.0.1/"),
      ).rejects.toThrow("private or reserved IP");
    });

    it("rejects the IPv6 IMDS metadata literal", async () => {
      await expect(
        validateOutboundUrl("http://[fd00:ec2::254]/latest/meta-data/"),
      ).rejects.toThrow("private or reserved IP");
    });

    it("rejects unknown schemes", async () => {
      await expect(
        validateOutboundUrl("ftp://example.com/"),
      ).rejects.toThrow("http or https");
      await expect(
        validateOutboundUrl("file:///etc/passwd"),
      ).rejects.toThrow("http or https");
    });

    it("rejects an unresolvable hostname", async () => {
      resolve4Mock.mockRejectedValue(new Error("ENOTFOUND") as never);
      resolve6Mock.mockRejectedValue(new Error("ENOTFOUND") as never);
      await expect(
        validateOutboundUrl("https://does-not-exist.example/"),
      ).rejects.toThrow("Could not resolve hostname");
    });

    it("rejects a hostname that resolves to an RFC 1918 IP (DNS rebinding)", async () => {
      resolve4Mock.mockResolvedValue(["10.0.0.50"]);
      resolve6Mock.mockResolvedValue([]);
      await expect(
        validateOutboundUrl("https://rebound.example/"),
      ).rejects.toThrow("private or reserved IP");
    });

    it("rejects a hostname that resolves to the AWS IMDS IP", async () => {
      resolve4Mock.mockResolvedValue(["169.254.169.254"]);
      resolve6Mock.mockResolvedValue([]);
      await expect(
        validateOutboundUrl("https://rebound-imds.example/"),
      ).rejects.toThrow("private or reserved IP");
    });

    it("accepts a hostname that resolves only to public IPs", async () => {
      resolve4Mock.mockResolvedValue(["198.51.100.42"]);
      resolve6Mock.mockResolvedValue(["2001:db8::1"]);
      // 2001:db8 is the IPv6 documentation prefix, but we don't reject that
      // explicitly; the test asserts only that public-IPv4 + an unrejected
      // IPv6 passes.
      await expect(
        validateOutboundUrl("https://public.example/api"),
      ).resolves.toBeUndefined();
    });
  });
});
