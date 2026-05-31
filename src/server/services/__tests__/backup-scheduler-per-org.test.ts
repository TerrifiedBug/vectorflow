import { describe, it, expect, beforeEach, vi } from "vitest";

// `vi.mock` factories are hoisted; their captured state must be hoisted too.
const mocks = vi.hoisted(() => {
  type FakeTask = {
    id: string;
    cron: string;
    stopped: boolean;
    cb: () => Promise<void>;
    stop: () => void;
  };
  const tasks: FakeTask[] = [];
  const cronValidate = vi.fn(
    (expr: string) => /^\S+ \S+ \S+ \S+ \S+$/.test(expr),
  );
  const cronSchedule = vi.fn(
    (expr: string, cb: () => Promise<void>): FakeTask => {
      const t: FakeTask = {
        id: `t${tasks.length}`,
        cron: expr,
        stopped: false,
        cb,
        stop() {
          t.stopped = true;
        },
      };
      tasks.push(t);
      return t;
    },
  );
  const findManyOrgs = vi.fn();
  const findUniqueOrg = vi.fn();
  const createBackup = vi.fn();
  const runRetentionCleanup = vi.fn();
  const runOrphanCleanup = vi.fn();
  const orgSettingsByOrg = new Map<
    string,
    { backupEnabled: boolean; backupCron: string | null }
  >();
  return {
    tasks,
    cronValidate,
    cronSchedule,
    findManyOrgs,
    findUniqueOrg,
    createBackup,
    runRetentionCleanup,
    runOrphanCleanup,
    orgSettingsByOrg,
  };
});

vi.mock("node-cron", () => ({
  default: {
    validate: mocks.cronValidate,
    schedule: mocks.cronSchedule,
  },
  validate: mocks.cronValidate,
  schedule: mocks.cronSchedule,
}));

vi.mock("@/lib/prisma", () => { const __pm = {
  organization: { findMany: mocks.findManyOrgs, findUnique: mocks.findUniqueOrg },
  environment: { findMany: vi.fn().mockResolvedValue([]) },
}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/server/services/backup", () => ({
  createBackup: mocks.createBackup,
  runRetentionCleanup: mocks.runRetentionCleanup,
  runOrphanCleanup: mocks.runOrphanCleanup,
}));

vi.mock("@/server/services/event-alerts", () => ({
  fireEventAlert: vi.fn(),
}));

vi.mock("@/server/services/event-alerts", () => ({
  fireEventAlert: vi.fn(),
}));

vi.mock("@/lib/org-settings", () => ({
  getOrgSettings: async (orgId: string) =>
    mocks.orgSettingsByOrg.get(orgId) ?? {
      backupEnabled: false,
      backupCron: null,
    },
}));

import {
  initBackupScheduler,
  rescheduleBackupForOrg,
  unscheduleBackupForOrg,
  _scheduledTasksForTests,
} from "../backup-scheduler";

describe("backup-scheduler — per-org tenancy", () => {
  beforeEach(() => {
    mocks.tasks.length = 0;
    mocks.cronValidate.mockClear();
    mocks.cronSchedule.mockClear();
    mocks.findManyOrgs.mockReset();
    mocks.findUniqueOrg.mockReset();
    mocks.createBackup.mockReset();
    mocks.runRetentionCleanup.mockReset();
    mocks.runOrphanCleanup.mockReset();
    mocks.orgSettingsByOrg.clear();
    _scheduledTasksForTests().clear();
  });

  it("registers one cron task per non-suspended, non-deleted org with backup enabled", async () => {
    mocks.findManyOrgs.mockResolvedValue([
      { id: "org-a", slug: "a" },
      { id: "org-b", slug: "b" },
      { id: "org-c", slug: "c" },
    ]);
    mocks.orgSettingsByOrg.set("org-a", {
      backupEnabled: true,
      backupCron: "0 3 * * *",
    });
    mocks.orgSettingsByOrg.set("org-b", {
      backupEnabled: false,
      backupCron: "0 3 * * *",
    });
    mocks.orgSettingsByOrg.set("org-c", {
      backupEnabled: true,
      backupCron: "0 4 * * *",
    });

    await initBackupScheduler();

    expect(_scheduledTasksForTests().size).toBe(2);
    expect(_scheduledTasksForTests().has("org-a")).toBe(true);
    expect(_scheduledTasksForTests().has("org-c")).toBe(true);
    expect(_scheduledTasksForTests().has("org-b")).toBe(false);
  });

  it("excludes suspended and deleted orgs from initial scheduling", async () => {
    mocks.findManyOrgs.mockResolvedValue([{ id: "org-live", slug: "live" }]);
    mocks.orgSettingsByOrg.set("org-live", {
      backupEnabled: true,
      backupCron: "0 3 * * *",
    });
    await initBackupScheduler();
    expect(mocks.findManyOrgs).toHaveBeenCalled();
    const where = mocks.findManyOrgs.mock.calls[0][0]?.where ?? {};
    expect(where.suspendedAt).toBe(null);
    expect(where.deletedAt).toBe(null);
  });

  it("rescheduleBackupForOrg replaces the task for that org without touching others", async () => {
    mocks.findManyOrgs.mockResolvedValue([{ id: "org-a" }, { id: "org-b" }]);
    mocks.orgSettingsByOrg.set("org-a", {
      backupEnabled: true,
      backupCron: "0 3 * * *",
    });
    mocks.orgSettingsByOrg.set("org-b", {
      backupEnabled: true,
      backupCron: "0 5 * * *",
    });
    await initBackupScheduler();
    const aTaskBefore = _scheduledTasksForTests().get("org-a");

    rescheduleBackupForOrg("org-a", true, "*/15 * * * *");
    const aTaskAfter = _scheduledTasksForTests().get("org-a");

    expect(aTaskBefore).not.toBe(aTaskAfter);
    expect((aTaskBefore as unknown as { stopped: boolean })?.stopped).toBe(true);
    expect((aTaskAfter as unknown as { cron: string })?.cron).toBe("*/15 * * * *");
    const bTask = _scheduledTasksForTests().get("org-b");
    expect((bTask as unknown as { cron: string })?.cron).toBe("0 5 * * *");
    expect((bTask as unknown as { stopped: boolean })?.stopped).toBe(false);
  });

  it("rescheduleBackupForOrg with enabled=false unregisters that org's task", () => {
    rescheduleBackupForOrg("org-a", true, "0 3 * * *");
    expect(_scheduledTasksForTests().size).toBe(1);
    rescheduleBackupForOrg("org-a", false, "0 3 * * *");
    expect(_scheduledTasksForTests().size).toBe(0);
  });

  it("rescheduleBackupForOrg rejects invalid cron without registering", () => {
    rescheduleBackupForOrg("org-a", true, "not-a-cron-expression");
    expect(_scheduledTasksForTests().size).toBe(0);
  });

  it("unscheduleBackupForOrg stops and forgets just that org's task", () => {
    rescheduleBackupForOrg("org-a", true, "0 3 * * *");
    rescheduleBackupForOrg("org-b", true, "0 4 * * *");
    expect(_scheduledTasksForTests().size).toBe(2);
    unscheduleBackupForOrg("org-a");
    expect(_scheduledTasksForTests().has("org-a")).toBe(false);
    expect(_scheduledTasksForTests().has("org-b")).toBe(true);
  });

  it("scheduler tick on failure scopes the env-alert query to the org", async () => {
    mocks.findManyOrgs.mockResolvedValue([{ id: "org-x" }]);
    mocks.orgSettingsByOrg.set("org-x", {
      backupEnabled: true,
      backupCron: "0 3 * * *",
    });
    // Force createBackup to fail so we reach the env-alert path.
    mocks.createBackup.mockRejectedValue(new Error("kaboom"));
    // Spy on prisma.environment.findMany via the existing prisma mock
    const { prisma } = await import("@/lib/prisma");
    const envFindMany = vi.spyOn(prisma.environment, "findMany").mockResolvedValue([]);

    await initBackupScheduler();
    await mocks.tasks[0].cb();

    // The failure-alert path MUST scope by organizationId, not run fleet-wide.
    expect(envFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-x" }),
      }),
    );
  });
});
