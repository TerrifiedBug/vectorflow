import { describe, it, expect } from "vitest";
import {
  generateEnrollmentToken,
  verifyEnrollmentToken,
  generateNodeToken,
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

    it("rejects an incorrect token", async () => {
      const { hash } = await generateEnrollmentToken();
      expect(await verifyEnrollmentToken("vf_enroll_wrong", hash)).toBe(false);
    });
  });

  describe("generateNodeToken", () => {
    it("returns token with vf_node_ prefix", async () => {
      const { token, hash } = await generateNodeToken();
      expect(token).toMatch(/^vf_node_[a-f0-9]{64}$/);
      expect(hash).toMatch(/^\$2[aby]\$/);
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

    it("rejects an incorrect token", async () => {
      const { hash } = await generateNodeToken();
      expect(await verifyNodeToken("vf_node_wrong", hash)).toBe(false);
    });
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
