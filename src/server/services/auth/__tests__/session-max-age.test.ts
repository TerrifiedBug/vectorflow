import { describe, it, expect } from "vitest";
import { authConfig } from "@/auth.config";

describe("suite session lifetime", () => {
  it("caps the JWT session maxAge at 24 hours (suite SSO contract)", () => {
    expect(authConfig.session).toMatchObject({
      strategy: "jwt",
      maxAge: 60 * 60 * 24,
    });
  });
});
