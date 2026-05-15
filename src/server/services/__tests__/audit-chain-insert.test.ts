import { describe, it, expect, vi } from "vitest";
import {
  computeAuditChainInsert,
  backfillChainForOrg,
} from "../audit-chain-insert";
import {
  genesisHashFor,
  computeChainHash,
  type ChainableAuditRow,
} from "../audit-chain";

function row(o: Partial<ChainableAuditRow> = {}): ChainableAuditRow {
  return {
    id: "a-1",
    organizationId: "org-a",
    userId: null,
    action: "pipeline.deploy",
    entityType: "Pipeline",
    entityId: "p-1",
    diff: null,
    metadata: null,
    ipAddress: null,
    userEmail: null,
    userName: null,
    teamId: null,
    environmentId: null,
    createdAt: new Date("2026-05-16T00:00:00Z"),
    ...o,
  };
}

describe("computeAuditChainInsert", () => {
  it("uses the org genesis when no tail row exists", () => {
    const r = row();
    const { prevHash, hash } = computeAuditChainInsert(r, null);
    expect(prevHash).toBe(genesisHashFor("org-a"));
    expect(hash).toBe(computeChainHash(prevHash, r));
  });

  it("uses the tail hash when a prior row exists", () => {
    const r = row({ id: "a-2" });
    const tailHash = "deadbeef".repeat(8);
    const { prevHash, hash } = computeAuditChainInsert(r, tailHash);
    expect(prevHash).toBe(tailHash);
    expect(hash).toBe(computeChainHash(tailHash, r));
  });
});

describe("backfillChainForOrg", () => {
  it("backfills a chain over ordered rows, writing prevHash + hash for each", async () => {
    const rows = [
      { ...row({ id: "x-1" }), prevHash: "", hash: "" },
      { ...row({ id: "x-2", action: "secret.read" }), prevHash: "", hash: "" },
      { ...row({ id: "x-3", action: "pipeline.delete" }), prevHash: "", hash: "" },
    ];
    const writes: Array<{ id: string; prevHash: string; hash: string }> = [];
    await backfillChainForOrg("org-a", {
      *iterate() {
        for (const r of rows) yield r;
      },
      async write(id, prevHash, hash) {
        writes.push({ id, prevHash, hash });
      },
    });

    expect(writes).toHaveLength(3);
    // First row anchored to org genesis
    expect(writes[0].prevHash).toBe(genesisHashFor("org-a"));
    // Chain links
    expect(writes[1].prevHash).toBe(writes[0].hash);
    expect(writes[2].prevHash).toBe(writes[1].hash);
  });

  it("skips rows that already have a non-empty hash (idempotent)", async () => {
    const r1 = { ...row({ id: "y-1" }), prevHash: "", hash: "" };
    // r2 is already hashed in a prior run
    const r2: ChainableAuditRow & { prevHash: string; hash: string } = {
      ...row({ id: "y-2", action: "secret.read" }),
      prevHash: "f".repeat(64),
      hash: "a".repeat(64),
    };
    const writes: Array<{ id: string; prevHash: string; hash: string }> = [];
    await backfillChainForOrg("org-a", {
      *iterate() {
        yield r1;
        yield r2;
      },
      async write(id, prevHash, hash) {
        writes.push({ id, prevHash, hash });
      },
    });
    // Only r1 should be written; r2 is skipped.
    expect(writes.map((w) => w.id)).toEqual(["y-1"]);
  });
});
