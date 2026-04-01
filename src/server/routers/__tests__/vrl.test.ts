import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t, writeFileMock, unlinkMock, mkdtempMock, execFileMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  const writeFileMock = vi.fn().mockResolvedValue(undefined);
  const unlinkMock = vi.fn().mockResolvedValue(undefined);
  const mkdtempMock = vi.fn().mockResolvedValue("/tmp/vectorflow-vrl-abc123");
  const execFileMock = vi.fn();
  return { t, writeFileMock, unlinkMock, mkdtempMock, execFileMock };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requireSuperAdmin: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("fs/promises", () => ({
  writeFile: writeFileMock,
  unlink: unlinkMock,
  mkdtemp: mkdtempMock,
}));

vi.mock("child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("util", async (importOriginal) => {
  const orig = await importOriginal<typeof import("util")>();
  return {
    ...orig,
    promisify: () => execFileMock,
  };
});

import { vrlRouter } from "@/server/routers/vrl";


const caller = t.createCallerFactory(vrlRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

describe("vrlRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeFileMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    mkdtempMock.mockResolvedValue("/tmp/vectorflow-vrl-abc123");
  });

  describe("test", () => {
    it("returns formatted output on successful VRL execution", async () => {
      execFileMock.mockResolvedValueOnce({
        stdout: '{"level":"info","message":"hello"}',
        stderr: "",
      });

      const result = await caller.test({
        source: '.level = "info"',
        input: '{"message":"hello"}',
      });

      expect(result.output).toBe(JSON.stringify({ level: "info", message: "hello" }, null, 2));
      expect(result.error).toBeUndefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns error when stderr is present", async () => {
      execFileMock.mockResolvedValueOnce({
        stdout: "partial output",
        stderr: "error: function call error for \"get\" (try \"get!\" or \"get?\")",
      });

      const result = await caller.test({
        source: '.x = get(.missing)',
        input: '{"message":"test"}',
      });

      expect(result.output).toBe("partial output");
      expect(result.error).toContain("function call error");
    });

    it("returns ENOENT error when vector binary is not found", async () => {
      const enoentError = new Error("spawn vector ENOENT") as NodeJS.ErrnoException;
      enoentError.code = "ENOENT";
      execFileMock.mockRejectedValueOnce(enoentError);

      const result = await caller.test({
        source: '.level = "info"',
        input: '{"message":"hello"}',
      });

      expect(result.output).toBe("");
      expect(result.error).toContain("VRL testing requires vector binary");
    });

    it("uses default input when input is empty", async () => {
      execFileMock.mockResolvedValueOnce({
        stdout: '{"level":"info"}',
        stderr: "",
      });

      const result = await caller.test({
        source: '.level = "info"',
        input: "",
      });

      expect(result.output).toBeDefined();
      // Verify writeFile was called with the program and a default input
      expect(writeFileMock).toHaveBeenCalledTimes(2);
      const inputArg = writeFileMock.mock.calls[1][1] as string;
      const parsed = JSON.parse(inputArg);
      expect(parsed).toHaveProperty("message", "test event");
      expect(parsed).toHaveProperty("host", "localhost");
    });

    it("cleans up temp files in finally block", async () => {
      execFileMock.mockResolvedValueOnce({
        stdout: "{}",
        stderr: "",
      });

      await caller.test({
        source: ". = {}",
        input: "{}",
      });

      // unlink is called for both program.vrl and input.json
      expect(unlinkMock).toHaveBeenCalledTimes(2);
      expect(unlinkMock).toHaveBeenCalledWith("/tmp/vectorflow-vrl-abc123/program.vrl");
      expect(unlinkMock).toHaveBeenCalledWith("/tmp/vectorflow-vrl-abc123/input.json");
    });

    it("returns error when execFile throws with stderr", async () => {
      const execErr = new Error("Process exited with code 1") as NodeJS.ErrnoException & { stderr: string };
      execErr.stderr = "error[E123]: unexpected token";
      execFileMock.mockRejectedValueOnce(execErr);

      const result = await caller.test({
        source: "invalid vrl syntax %%%",
        input: "{}",
      });

      expect(result.output).toBe("");
      expect(result.error).toBe("error[E123]: unexpected token");
    });
  });
});
