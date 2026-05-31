import { describe, it, expect } from "vitest";
import { runWithOrgContext, getOrgId, assertValidOrgId } from "../org-context";

describe("org-context", () => {
  describe("assertValidOrgId", () => {
    it("accepts a valid org id", () => {
      expect(() => assertValidOrgId("org-Abc_123")).not.toThrow();
      expect(() => assertValidOrgId("default")).not.toThrow();
    });

    it("rejects an empty string", () => {
      expect(() => assertValidOrgId("")).toThrow(/orgId/);
    });

    it("rejects an id longer than 64 chars", () => {
      expect(() => assertValidOrgId("a".repeat(65))).toThrow(/64/);
    });

    it("rejects injection-shaped characters", () => {
      expect(() => assertValidOrgId("org'; DROP TABLE users;--")).toThrow(/orgId/);
      expect(() => assertValidOrgId("a b")).toThrow(/orgId/);
    });

    it("surfaces the caller label in the message", () => {
      expect(() => assertValidOrgId("", "withOrgTx")).toThrow(/withOrgTx/);
    });
  });

  describe("getOrgId / runWithOrgContext", () => {
    it("returns undefined outside any scope", () => {
      expect(getOrgId()).toBeUndefined();
    });

    it("exposes the org id inside the scope", async () => {
      const seen = await runWithOrgContext("org-a", async () => getOrgId());
      expect(seen).toBe("org-a");
    });

    it("keeps the scope active across awaits inside fn", async () => {
      const observed = await runWithOrgContext("org-b", async () => {
        const a = getOrgId();
        await Promise.resolve();
        await Promise.resolve();
        const b = getOrgId();
        return { a, b };
      });
      expect(observed).toEqual({ a: "org-b", b: "org-b" });
    });

    it("keeps the scope active for work deferred to a microtask inside fn", async () => {
      // Mirrors how the Prisma RLS extension reads getOrgId() when a query
      // resolves: the wrapper awaits fn inside storage.run, so work that runs
      // after a microtask boundary still observes the org (the bug returned the
      // promise OUT of scope, and the deferred read saw `undefined`).
      let sawDuringDefer: string | undefined = "unset";
      const result = await runWithOrgContext("org-lazy", () =>
        Promise.resolve().then(() => {
          sawDuringDefer = getOrgId();
          return "done";
        }),
      );
      expect(result).toBe("done");
      expect(sawDuringDefer).toBe("org-lazy");
    });

    it("clears the scope after the wrapped fn settles", async () => {
      await runWithOrgContext("org-c", async () => getOrgId());
      expect(getOrgId()).toBeUndefined();
    });

    it("clears the scope even when fn rejects", async () => {
      await expect(
        runWithOrgContext("org-d", async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(getOrgId()).toBeUndefined();
    });

    it("nested scope shadows the outer for its duration", async () => {
      const observed: Array<string | undefined> = [];
      await runWithOrgContext("outer", async () => {
        observed.push(getOrgId());
        await runWithOrgContext("inner", async () => {
          observed.push(getOrgId());
        });
        observed.push(getOrgId());
      });
      expect(observed).toEqual(["outer", "inner", "outer"]);
    });

    it("validates the org id before establishing scope", async () => {
      await expect(runWithOrgContext("", async () => "x")).rejects.toThrow(/orgId/);
    });

    it("isolates concurrent scopes (no cross-talk between interleaved requests)", async () => {
      const [a, b] = await Promise.all([
        runWithOrgContext("org-1", async () => {
          await Promise.resolve();
          return getOrgId();
        }),
        runWithOrgContext("org-2", async () => {
          await Promise.resolve();
          return getOrgId();
        }),
      ]);
      expect(a).toBe("org-1");
      expect(b).toBe("org-2");
    });
  });
});
