import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  infoLog: vi.fn(),
  errorLog: vi.fn(),
  warnLog: vi.fn(),
  debugLog: vi.fn(),
}));

import {
  assertStrictMultiTenantBoot,
  warnTrustForwardedHostIfOn,
} from "../strict-multi-tenant-bootcheck";
import { errorLog, infoLog, warnLog } from "@/lib/logger";

const ENV_KEYS = [
  "VF_STRICT_MULTI_TENANT",
  "NEXTAUTH_SECRET_OPERATOR",
  "VF_REQUIRE_STRICT_MULTI_TENANT",
  "VF_TRUST_FORWARDED_HOST",
] as const;
const ORIGINAL: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) ORIGINAL[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  vi.clearAllMocks();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k]!;
  }
});

describe("assertStrictMultiTenantBoot", () => {
  it("is a no-op when no strict-mode signal is present (OSS single-tenant)", () => {
    const exit = vi.fn(() => {
      throw new Error("exit should not be called");
    });
    expect(() => assertStrictMultiTenantBoot({ exit: exit as never })).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("exits 1 when NEXTAUTH_SECRET_OPERATOR is set but strict mode is off", () => {
    process.env.NEXTAUTH_SECRET_OPERATOR = "operator-secret-xx";
    const exit = vi.fn((code: number) => {
      throw new Error(`exit-${code}`);
    });
    expect(() => assertStrictMultiTenantBoot({ exit: exit as never })).toThrow(
      "exit-1",
    );
    expect(errorLog).toHaveBeenCalledWith(
      "instrumentation",
      expect.stringContaining("NEXTAUTH_SECRET_OPERATOR is set"),
    );
  });

  it("exits 1 when VF_REQUIRE_STRICT_MULTI_TENANT=true but strict mode is off", () => {
    process.env.VF_REQUIRE_STRICT_MULTI_TENANT = "true";
    const exit = vi.fn((code: number) => {
      throw new Error(`exit-${code}`);
    });
    expect(() => assertStrictMultiTenantBoot({ exit: exit as never })).toThrow(
      "exit-1",
    );
    expect(errorLog).toHaveBeenCalledWith(
      "instrumentation",
      expect.stringContaining("VF_REQUIRE_STRICT_MULTI_TENANT=true"),
    );
  });

  it("rejects common VF_STRICT_MULTI_TENANT typos that look enabled but aren't", () => {
    process.env.NEXTAUTH_SECRET_OPERATOR = "x";
    process.env.VF_STRICT_MULTI_TENANT = "1"; // not "true"
    const exit = vi.fn((code: number) => {
      throw new Error(`exit-${code}`);
    });
    expect(() => assertStrictMultiTenantBoot({ exit: exit as never })).toThrow(
      "exit-1",
    );
  });

  it("passes silently and logs INFO when strict mode is on and a signal is present", () => {
    process.env.NEXTAUTH_SECRET_OPERATOR = "x";
    process.env.VF_STRICT_MULTI_TENANT = "true";
    const exit = vi.fn(() => {
      throw new Error("exit should not be called");
    });
    expect(() => assertStrictMultiTenantBoot({ exit: exit as never })).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
    expect(infoLog).toHaveBeenCalledWith(
      "instrumentation",
      expect.stringContaining("Strict multi-tenant mode confirmed"),
    );
  });
});

describe("warnTrustForwardedHostIfOn", () => {
  it("is silent when the flag is unset", () => {
    warnTrustForwardedHostIfOn();
    expect(warnLog).not.toHaveBeenCalled();
  });
  it("is silent when the flag is any value other than \"true\"", () => {
    process.env.VF_TRUST_FORWARDED_HOST = "1";
    warnTrustForwardedHostIfOn();
    expect(warnLog).not.toHaveBeenCalled();
  });
  it("warns loudly when the flag is exactly \"true\"", () => {
    process.env.VF_TRUST_FORWARDED_HOST = "true";
    warnTrustForwardedHostIfOn();
    expect(warnLog).toHaveBeenCalledWith(
      "instrumentation",
      expect.stringContaining("VF_TRUST_FORWARDED_HOST=true"),
    );
  });
});
