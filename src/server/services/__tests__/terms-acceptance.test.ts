import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import { prisma } from "@/lib/prisma";
import {
  getCurrentTermsVersion,
  getOrgTermsAcceptanceStatus,
  recordOrgTermsAcceptance,
} from "../terms-acceptance";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const ORIGINAL_ENV = process.env.VF_TERMS_CURRENT_VERSION;

beforeEach(() => {
  mockReset(prismaMock);
  delete process.env.VF_TERMS_CURRENT_VERSION;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.VF_TERMS_CURRENT_VERSION;
  } else {
    process.env.VF_TERMS_CURRENT_VERSION = ORIGINAL_ENV;
  }
});

describe("getCurrentTermsVersion", () => {
  it("returns the env value when set", () => {
    process.env.VF_TERMS_CURRENT_VERSION = "2026-01-15";
    expect(getCurrentTermsVersion()).toBe("2026-01-15");
  });

  it("returns empty string when env is unset (single-tenant default)", () => {
    delete process.env.VF_TERMS_CURRENT_VERSION;
    expect(getCurrentTermsVersion()).toBe("");
  });
});

describe("getOrgTermsAcceptanceStatus", () => {
  it("short-circuits to accepted when the operator has not published a version", async () => {
    delete process.env.VF_TERMS_CURRENT_VERSION;
    const status = await getOrgTermsAcceptanceStatus("org-1");
    expect(status).toEqual({
      accepted: true,
      acceptedVersion: null,
      acceptedAt: null,
      currentVersion: "",
    });
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });

  it("returns accepted=true when the org's recorded version matches the current published version", async () => {
    process.env.VF_TERMS_CURRENT_VERSION = "2026-01-15";
    const at = new Date("2026-01-15T10:00:00Z");
    prismaMock.organization.findUnique.mockResolvedValue({
      acceptedTermsVersion: "2026-01-15",
      acceptedTermsAt: at,
    } as never);

    const status = await getOrgTermsAcceptanceStatus("org-1");
    expect(status.accepted).toBe(true);
    expect(status.acceptedVersion).toBe("2026-01-15");
    expect(status.acceptedAt).toBe(at);
    expect(status.currentVersion).toBe("2026-01-15");
  });

  it("returns accepted=false when the org has never accepted (null version)", async () => {
    process.env.VF_TERMS_CURRENT_VERSION = "2026-01-15";
    prismaMock.organization.findUnique.mockResolvedValue({
      acceptedTermsVersion: null,
      acceptedTermsAt: null,
    } as never);

    const status = await getOrgTermsAcceptanceStatus("org-1");
    expect(status.accepted).toBe(false);
    expect(status.acceptedVersion).toBeNull();
    expect(status.currentVersion).toBe("2026-01-15");
  });

  it("returns accepted=false on a stale version (forced re-acceptance after terms revision)", async () => {
    process.env.VF_TERMS_CURRENT_VERSION = "2026-03-01";
    prismaMock.organization.findUnique.mockResolvedValue({
      acceptedTermsVersion: "2026-01-15",
      acceptedTermsAt: new Date("2026-01-15T10:00:00Z"),
    } as never);

    const status = await getOrgTermsAcceptanceStatus("org-1");
    expect(status.accepted).toBe(false);
    expect(status.acceptedVersion).toBe("2026-01-15");
    expect(status.currentVersion).toBe("2026-03-01");
  });

  it("returns accepted=false when the org row is missing entirely", async () => {
    process.env.VF_TERMS_CURRENT_VERSION = "2026-01-15";
    prismaMock.organization.findUnique.mockResolvedValue(null);
    const status = await getOrgTermsAcceptanceStatus("org-1");
    expect(status.accepted).toBe(false);
  });
});

describe("recordOrgTermsAcceptance", () => {
  it("updates the org with current timestamp and supplied version", async () => {
    prismaMock.organization.update.mockResolvedValue({} as never);
    await recordOrgTermsAcceptance({
      organizationId: "org-1",
      version: "2026-01-15",
    });

    const calls = prismaMock.organization.update.mock.calls;
    expect(calls).toHaveLength(1);
    const [args] = calls[0]!;
    expect(args?.where).toEqual({ id: "org-1" });
    expect(args?.data?.acceptedTermsVersion).toBe("2026-01-15");
    expect(args?.data?.acceptedTermsAt).toBeInstanceOf(Date);
  });

  it("throws on empty version (defensive — caller MUST resolve before recording)", async () => {
    await expect(
      recordOrgTermsAcceptance({ organizationId: "org-1", version: "" }),
    ).rejects.toThrow(/non-empty/);
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });
});
