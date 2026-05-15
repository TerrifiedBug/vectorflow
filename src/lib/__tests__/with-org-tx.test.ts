import { describe, it, expect, vi } from "vitest";
import { withOrgTxOn } from "../with-org-tx";

describe("withOrgTx", () => {
  function makePrismaMock() {
    const setLocalCalls: Array<{ sql: string; values: unknown[] }> = [];
    const txClient = {
      $executeRaw: vi.fn(
        (template: TemplateStringsArray, ...values: unknown[]) => {
          setLocalCalls.push({ sql: template.join("?"), values });
          return Promise.resolve(1);
        },
      ),
    };
    const txMock = vi.fn(
      async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient),
    );
    return {
      prisma: { $transaction: txMock } as unknown as Parameters<typeof withOrgTxOn>[0],
      txClient,
      setLocalCalls,
      txMock,
    };
  }

  it("wraps the callback in $transaction", async () => {
    const { prisma, txMock } = makePrismaMock();
    await withOrgTxOn(prisma, "org-a", async () => "result");
    expect(txMock).toHaveBeenCalledTimes(1);
  });

  it("sets app.org_id via set_config(_, _, true) inside the transaction before running fn", async () => {
    const { prisma, setLocalCalls } = makePrismaMock();
    let observedSetBefore = false;
    await withOrgTxOn(prisma, "org-a", async () => {
      observedSetBefore = setLocalCalls.length === 1;
      return "ok";
    });
    expect(observedSetBefore).toBe(true);
    expect(setLocalCalls).toHaveLength(1);
    expect(setLocalCalls[0].sql).toContain("set_config");
    // app.org_id name and the `true` (local) flag must be present
    expect(setLocalCalls[0].sql).toContain("app.org_id");
    expect(setLocalCalls[0].values).toEqual(["org-a", true]);
  });

  it("returns the callback's return value", async () => {
    const { prisma } = makePrismaMock();
    const result = await withOrgTxOn(prisma, "org-a", async () => ({ x: 1 }));
    expect(result).toEqual({ x: 1 });
  });

  it("propagates callback errors (transaction rolls back)", async () => {
    const { prisma } = makePrismaMock();
    await expect(
      withOrgTxOn(prisma, "org-a", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("rejects empty orgId at the boundary (defence in depth)", async () => {
    const { prisma } = makePrismaMock();
    await expect(
      withOrgTxOn(prisma, "", async () => "x"),
    ).rejects.toThrow(/orgId/);
  });

  it("rejects orgIds that look like a SQL injection or are not a stable identifier", async () => {
    // The implementation MUST use parameterised set_config — but reject
    // obviously-malformed identifiers before reaching the DB anyway.
    const { prisma } = makePrismaMock();
    await expect(
      withOrgTxOn(prisma, "org-a'; DROP TABLE users;--", async () => "x"),
    ).rejects.toThrow(/orgId/);
  });
});
