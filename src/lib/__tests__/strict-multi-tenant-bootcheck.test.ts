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
  assertRlsEnforcementBoot,
} from "../strict-multi-tenant-bootcheck";
import { errorLog, infoLog, warnLog } from "@/lib/logger";

const ENV_KEYS = [
  "VF_STRICT_MULTI_TENANT",
  "NEXTAUTH_SECRET_OPERATOR",
  "VF_REQUIRE_STRICT_MULTI_TENANT",
  "VF_TRUST_FORWARDED_HOST",
  "VF_TRUST_PROXY_HEADERS",
  "VF_ENFORCE_RLS",
  "DATABASE_ADMIN_URL",
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
  it("is silent when neither flag is set", () => {
    warnTrustForwardedHostIfOn();
    expect(warnLog).not.toHaveBeenCalled();
  });
  it('is silent when VF_TRUST_FORWARDED_HOST is any value other than "true"', () => {
    process.env.VF_TRUST_FORWARDED_HOST = "1";
    warnTrustForwardedHostIfOn();
    expect(warnLog).not.toHaveBeenCalled();
  });
  it("warns loudly when VF_TRUST_FORWARDED_HOST=true", () => {
    process.env.VF_TRUST_FORWARDED_HOST = "true";
    warnTrustForwardedHostIfOn();
    expect(warnLog).toHaveBeenCalledWith(
      "instrumentation",
      expect.stringContaining("VF_TRUST_FORWARDED_HOST=true"),
    );
  });
  it("warns about the asymmetry when only VF_TRUST_PROXY_HEADERS is set", () => {
    // Codex P1: the two flags are NOT synonymous. The IP-trust flag
    // alone must NOT silently widen host trust; surface the gap.
    process.env.VF_TRUST_PROXY_HEADERS = "true";
    warnTrustForwardedHostIfOn();
    expect(warnLog).toHaveBeenCalledWith(
      "instrumentation",
      expect.stringContaining("VF_TRUST_PROXY_HEADERS=true is set but"),
    );
  });
  it("does NOT emit the asymmetry warning when both flags are set", () => {
    process.env.VF_TRUST_FORWARDED_HOST = "true";
    process.env.VF_TRUST_PROXY_HEADERS = "true";
    warnTrustForwardedHostIfOn();
    // Only the primary warning, not the asymmetry one.
    const asymmetryCalls = (warnLog as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("VF_TRUST_PROXY_HEADERS=true is set but"),
    );
    expect(asymmetryCalls.length).toBe(0);
  });
});

type ProbeScenario = {
  bypass: boolean;
  policyTable: string | null;
  leaked: boolean;
  throwOn?: string;
};

function makeProbeClient(s: ProbeScenario) {
  return {
    $queryRawUnsafe: vi.fn(async (q: string) => {
      if (s.throwOn && q.includes(s.throwOn)) throw new Error("probe query failed");
      if (q.includes("pg_roles")) return [{ rolbypassrls: s.bypass }];
      if (q.includes("pg_policies")) {
        return s.policyTable ? [{ tablename: s.policyTable }] : [];
      }
      if (q.includes("EXISTS")) return [{ leaked: s.leaked }];
      return [];
    }),
  };
}

describe("assertRlsEnforcementBoot", () => {
  it("is a no-op when VF_ENFORCE_RLS is unset", async () => {
    const exit = vi.fn();
    const client = makeProbeClient({ bypass: true, policyTable: null, leaked: true });
    await assertRlsEnforcementBoot({ exit: exit as never, client: client as never });
    expect(client.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("refuses to boot when the app role bypasses RLS", async () => {
    process.env.VF_ENFORCE_RLS = "true";
    const exit = vi.fn();
    const client = makeProbeClient({ bypass: true, policyTable: "Team", leaked: false });
    await assertRlsEnforcementBoot({ exit: exit as never, client: client as never });
    expect(exit).toHaveBeenCalledWith(1);
    expect(errorLog).toHaveBeenCalled();
  });

  it("refuses to boot when no app.org_id policy is provisioned", async () => {
    process.env.VF_ENFORCE_RLS = "true";
    const exit = vi.fn();
    const client = makeProbeClient({ bypass: false, policyTable: null, leaked: false });
    await assertRlsEnforcementBoot({ exit: exit as never, client: client as never });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("refuses to boot when a tenant table leaks rows with no GUC set", async () => {
    process.env.VF_ENFORCE_RLS = "true";
    const exit = vi.fn();
    const client = makeProbeClient({ bypass: false, policyTable: "Team", leaked: true });
    await assertRlsEnforcementBoot({ exit: exit as never, client: client as never });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("passes on a non-bypass role where the policy fires", async () => {
    process.env.VF_ENFORCE_RLS = "true";
    process.env.DATABASE_ADMIN_URL = "postgresql://owner@localhost:5432/db";
    const exit = vi.fn();
    const client = makeProbeClient({ bypass: false, policyTable: "Team", leaked: false });
    await assertRlsEnforcementBoot({ exit: exit as never, client: client as never });
    expect(exit).not.toHaveBeenCalled();
    expect(infoLog).toHaveBeenCalled();
  });

  it("refuses to boot when DATABASE_ADMIN_URL is unset (admin paths inherit the fence)", async () => {
    process.env.VF_ENFORCE_RLS = "true";
    delete process.env.DATABASE_ADMIN_URL;
    const exit = vi.fn();
    const client = makeProbeClient({ bypass: false, policyTable: "Team", leaked: false });
    await assertRlsEnforcementBoot({ exit: exit as never, client: client as never });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("refuses to boot when the probe query throws", async () => {
    process.env.VF_ENFORCE_RLS = "true";
    const exit = vi.fn();
    const client = makeProbeClient({ bypass: false, policyTable: "Team", leaked: false, throwOn: "pg_roles" });
    await assertRlsEnforcementBoot({ exit: exit as never, client: client as never });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
