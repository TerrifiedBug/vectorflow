import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => { const __pm = {
  organization: { findUnique: mocks.findUnique },
}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import { getOrgConstraints, type OrgConstraints } from "../org-constraints";

describe("getOrgConstraints", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset();
    delete process.env.NEXT_PUBLIC_VF_DEMO_MODE;
  });

  it("returns live constraints for an active org", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "org-a",
      suspendedAt: null,
      deletedAt: null,
      plan: "FREE",
    });
    const c = await getOrgConstraints("org-a");
    expect(c.reason).toBe("live");
    expect(c.agentEnrollmentEnabled).toBe(true);
    expect(c.aiEnabled).toBe(true);
    expect(c.emailEnabled).toBe(true);
    expect(c.gitSyncEnabled).toBe(true);
    expect(c.deployEnabled).toBe(true);
  });

  it("treats demo mode as a constraint regardless of org row state", async () => {
    process.env.NEXT_PUBLIC_VF_DEMO_MODE = "true";
    mocks.findUnique.mockResolvedValue({
      id: "org-a",
      suspendedAt: null,
      deletedAt: null,
      plan: "FREE",
    });
    const c = await getOrgConstraints("org-a");
    expect(c.reason).toBe("demo");
    expect(c.agentEnrollmentEnabled).toBe(false);
    expect(c.aiEnabled).toBe(false);
    expect(c.emailEnabled).toBe(false);
    expect(c.gitSyncEnabled).toBe(false);
    expect(c.deployEnabled).toBe(false);
  });

  it("returns suspended constraints when org has suspendedAt", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "org-a",
      suspendedAt: new Date("2026-05-15"),
      deletedAt: null,
      plan: "PRO",
    });
    const c = await getOrgConstraints("org-a");
    expect(c.reason).toBe("suspended");
    expect(c.agentEnrollmentEnabled).toBe(false);
    expect(c.aiEnabled).toBe(false);
    expect(c.emailEnabled).toBe(false);
    expect(c.gitSyncEnabled).toBe(false);
    expect(c.deployEnabled).toBe(false);
  });

  it("returns deleted constraints when org has deletedAt (precedence over suspended)", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "org-a",
      suspendedAt: new Date("2026-05-15"),
      deletedAt: new Date("2026-05-16"),
      plan: "PRO",
    });
    const c = await getOrgConstraints("org-a");
    expect(c.reason).toBe("deleted");
    // All flags off; org is in soft-delete grace window.
    expect(c.agentEnrollmentEnabled).toBe(false);
    expect(c.deployEnabled).toBe(false);
  });

  it("returns deleted when the org row does not exist (unknown org)", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const c = await getOrgConstraints("org-missing");
    expect(c.reason).toBe("deleted");
    expect(c.agentEnrollmentEnabled).toBe(false);
  });

  it("demo mode precedes live (even when org is healthy)", async () => {
    process.env.NEXT_PUBLIC_VF_DEMO_MODE = "true";
    mocks.findUnique.mockResolvedValue({
      id: "org-a",
      suspendedAt: null,
      deletedAt: null,
      plan: "PRO",
    });
    const c: OrgConstraints = await getOrgConstraints("org-a");
    expect(c.reason).toBe("demo");
  });

  it("deleted/suspended precedes demo (operator state outweighs demo mode)", async () => {
    process.env.NEXT_PUBLIC_VF_DEMO_MODE = "true";
    mocks.findUnique.mockResolvedValue({
      id: "org-a",
      suspendedAt: new Date(),
      deletedAt: null,
      plan: "FREE",
    });
    const c = await getOrgConstraints("org-a");
    // demo mode is a deployment-wide gate; a suspended org should still
    // be classified as suspended for accurate operator visibility.
    expect(c.reason).toBe("suspended");
  });

  it("includes the org plan in the result", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "org-a",
      suspendedAt: null,
      deletedAt: null,
      plan: "ENTERPRISE",
    });
    const c = await getOrgConstraints("org-a");
    expect(c.plan).toBe("ENTERPRISE");
  });
});
