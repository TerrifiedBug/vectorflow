import { describe, it, expect } from "vitest";
import {
  generateEnrollmentToken,
  verifyEnrollmentToken,
  generateNodeToken,
  getNodeTokenIdentifier,
  verifyNodeToken,
  extractBearerToken,
} from "../agent-token";

describe("agent-token", () => {
  describe("generateEnrollmentToken", () => {
    it("returns token with vf_enroll_ prefix", async () => {
      const { token, hash, hint } = await generateEnrollmentToken();
      expect(token).toMatch(/^vf_enroll_[a-f0-9]{64}$/);
      expect(hash).toMatch(/^\$2[aby]\$/);
      expect(hint).toMatch(/^\*{4}.{4}$/);
    });

    it("generates unique tokens on each call", async () => {
      const a = await generateEnrollmentToken();
      const b = await generateEnrollmentToken();
      expect(a.token).not.toBe(b.token);
      expect(a.hash).not.toBe(b.hash);
    });
  });

  describe("verifyEnrollmentToken", () => {
    it("verifies a valid token against its hash", async () => {
      const { token, hash } = await generateEnrollmentToken();
      expect(await verifyEnrollmentToken(token, hash)).toBe(true);
    });

    it("rejects a token with wrong prefix", async () => {
      const { hash } = await generateEnrollmentToken();
      expect(await verifyEnrollmentToken("vf_node_abc123", hash)).toBe(false);
    });

    // bcrypt.compare() against a mismatched token runs the full bcrypt round — intentionally
    // slow by design. 15 s gives plenty of headroom on a loaded CI runner.
    it("rejects an incorrect token", async () => {
      const { hash } = await generateEnrollmentToken();
      expect(await verifyEnrollmentToken("vf_enroll_wrong", hash)).toBe(false);
    }, 15_000);
  });

  describe("generateNodeToken", () => {
    it("returns token with stable lookup identifier", async () => {
      const { token, hash, identifier } = await generateNodeToken();
      expect(token).toMatch(/^vf_node_[a-f0-9]{16}_[a-f0-9]{64}$/);
      expect(identifier).toMatch(/^[a-f0-9]{16}$/);
      expect(getNodeTokenIdentifier(token)).toBe(identifier);
      expect(hash).toMatch(/^\$2[aby]\$/);
    });
  });

  describe("getNodeTokenIdentifier", () => {
    it("extracts the stable lookup identifier from a node token", () => {
      expect(
        getNodeTokenIdentifier(
          "vf_node_0123456789abcdef_fedcba98765432100123456789abcdeffedcba98765432100123456789abcdef",
        ),
      ).toBe("0123456789abcdef");
    });

    it("returns null for legacy or malformed node tokens", () => {
      expect(getNodeTokenIdentifier("vf_node_abc123")).toBeNull();
      expect(getNodeTokenIdentifier("vf_enroll_0123456789abcdef")).toBeNull();
      expect(getNodeTokenIdentifier("vf_node_0123456789abcdef")).toBeNull();
    });
  });

  describe("verifyNodeToken", () => {
    it("verifies a valid token against its hash", async () => {
      const { token, hash } = await generateNodeToken();
      expect(await verifyNodeToken(token, hash)).toBe(true);
    });

    it("rejects a token with enrollment prefix", async () => {
      const { hash } = await generateNodeToken();
      const { token: enrollToken } = await generateEnrollmentToken();
      expect(await verifyNodeToken(enrollToken, hash)).toBe(false);
    });

    // bcrypt.compare() against a mismatched token runs the full bcrypt round — intentionally
    // slow by design. 15 s gives plenty of headroom on a loaded CI runner.
    it("rejects an incorrect token", async () => {
      const { hash } = await generateNodeToken();
      expect(await verifyNodeToken("vf_node_wrong", hash)).toBe(false);
    }, 15_000);
  });

  describe("extractBearerToken", () => {
    it("extracts token from valid Bearer header", () => {
      expect(extractBearerToken("Bearer my-token-123")).toBe("my-token-123");
    });

    it("returns null for null header", () => {
      expect(extractBearerToken(null)).toBeNull();
    });

    it("returns null for undefined header", () => {
      expect(extractBearerToken(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(extractBearerToken("")).toBeNull();
    });

    it("returns null for Basic auth header", () => {
      expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    });

    it("returns null for 'Bearer' with no token", () => {
      expect(extractBearerToken("Bearer")).toBeNull();
    });

    it("returns token including spaces after first space", () => {
      expect(extractBearerToken("Bearer token with spaces")).toBe(
        "token with spaces",
      );
    });
  });
});
