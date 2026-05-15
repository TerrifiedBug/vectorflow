import { describe, it, expect } from "vitest";
import { computeAuditChainInsert } from "../audit-chain-insert";
import {
  computeChainHash,
  genesisHashFor,
  type ChainableAuditRow,
} from "../audit-chain";

const row = (o: Partial<ChainableAuditRow> = {}): ChainableAuditRow => ({
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
});

describe("computeAuditChainInsert", () => {
  it("anchors to org genesis when no tail is present", () => {
    const r = row();
    const { prevHash, hash } = computeAuditChainInsert(r, null);
    expect(prevHash).toBe(genesisHashFor("org-a"));
    expect(hash).toBe(computeChainHash(prevHash, r));
  });

  it("anchors to tail hash when a chained row exists", () => {
    const tailHash = "f".repeat(64);
    const r = row();
    const { prevHash, hash } = computeAuditChainInsert(r, tailHash);
    expect(prevHash).toBe(tailHash);
    expect(hash).toBe(computeChainHash(tailHash, r));
  });
});
