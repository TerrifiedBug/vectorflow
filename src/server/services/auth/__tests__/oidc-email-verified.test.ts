import { describe, it, expect } from "vitest";
import { isOidcEmailVerified } from "../oidc-email-verified";

describe("isOidcEmailVerified (VF-31)", () => {
  it("allows when email_verified is boolean true", () => {
    expect(isOidcEmailVerified({ email_verified: true })).toBe(true);
  });

  it("blocks when email_verified is boolean false", () => {
    expect(isOidcEmailVerified({ email_verified: false })).toBe(false);
  });

  it('allows the string "true" (IdPs that stringify the claim)', () => {
    expect(isOidcEmailVerified({ email_verified: "true" })).toBe(true);
    expect(isOidcEmailVerified({ email_verified: "TRUE" })).toBe(true);
    expect(isOidcEmailVerified({ email_verified: " true " })).toBe(true);
  });

  it('blocks the string "false"', () => {
    expect(isOidcEmailVerified({ email_verified: "false" })).toBe(false);
    expect(isOidcEmailVerified({ email_verified: "0" })).toBe(false);
    expect(isOidcEmailVerified({ email_verified: "" })).toBe(false);
  });

  it("allows when the claim is absent (optional claim, trust bounded by per-org issuer)", () => {
    expect(isOidcEmailVerified({})).toBe(true);
    expect(isOidcEmailVerified({ email: "user@example.com" })).toBe(true);
  });

  it("allows when the claim is explicitly null/undefined", () => {
    expect(isOidcEmailVerified({ email_verified: null })).toBe(true);
    expect(isOidcEmailVerified({ email_verified: undefined })).toBe(true);
  });

  it("allows when the profile itself is undefined or null", () => {
    expect(isOidcEmailVerified(undefined)).toBe(true);
    expect(isOidcEmailVerified(null)).toBe(true);
  });

  it("blocks untrustworthy non-boolean/non-string shapes", () => {
    expect(isOidcEmailVerified({ email_verified: 1 as unknown as boolean })).toBe(false);
    expect(isOidcEmailVerified({ email_verified: {} as unknown as boolean })).toBe(false);
  });
});
