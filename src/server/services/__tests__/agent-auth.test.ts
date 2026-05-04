import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("../agent-token", () => ({
  extractBearerToken: vi.fn(),
  getNodeTokenIdentifier: vi.fn(),
  verifyNodeToken: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  extractBearerToken,
  getNodeTokenIdentifier,
  verifyNodeToken,
} from "../agent-token";
import { authenticateAgent } from "../agent-auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const extractBearerTokenMock = extractBearerToken as ReturnType<typeof vi.fn>;
const getNodeTokenIdentifierMock = getNodeTokenIdentifier as ReturnType<typeof vi.fn>;
const verifyNodeTokenMock = verifyNodeToken as ReturnType<typeof vi.fn>;

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/agent/heartbeat", { headers });
}

describe("authenticateAgent", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("returns null when no authorization header", async () => {
    extractBearerTokenMock.mockReturnValue(null);

    const result = await authenticateAgent(makeRequest());
    expect(result).toBeNull();
    expect(prismaMock.vectorNode.findMany).not.toHaveBeenCalled();
    expect(prismaMock.vectorNode.findUnique).not.toHaveBeenCalled();
  });

  it("falls back to legacy scan when token has no stable lookup identifier", async () => {
    extractBearerTokenMock.mockReturnValue("vf_node_oldformat64hex");
    getNodeTokenIdentifierMock.mockReturnValue(null);
    prismaMock.vectorNode.findMany.mockResolvedValue([
      {
        id: "legacy-node-1",
        environmentId: "env-legacy",
        nodeTokenHash: "legacy-hash",
      },
    ] as never);
    verifyNodeTokenMock.mockResolvedValue(true);

    const result = await authenticateAgent(makeRequest("Bearer vf_node_oldformat64hex"));
    expect(result).toEqual({ nodeId: "legacy-node-1", environmentId: "env-legacy" });
    expect(prismaMock.vectorNode.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.vectorNode.findMany).toHaveBeenCalledWith({
      where: { nodeTokenHash: { not: null }, nodeTokenId: null },
      select: { id: true, environmentId: true, nodeTokenHash: true },
    });
  });

  it("returns null for legacy token when no un-migrated nodes match", async () => {
    extractBearerTokenMock.mockReturnValue("vf_node_oldformat64hex");
    getNodeTokenIdentifierMock.mockReturnValue(null);
    prismaMock.vectorNode.findMany.mockResolvedValue([
      {
        id: "legacy-node-1",
        environmentId: "env-legacy",
        nodeTokenHash: "legacy-hash",
      },
    ] as never);
    verifyNodeTokenMock.mockResolvedValue(false);

    const result = await authenticateAgent(makeRequest("Bearer vf_node_oldformat64hex"));
    expect(result).toBeNull();
  });

  it("returns null when token id matches no node", async () => {
    extractBearerTokenMock.mockReturnValue("vf_node_token-id_secret");
    getNodeTokenIdentifierMock.mockReturnValue("token-id");
    prismaMock.vectorNode.findUnique.mockResolvedValue(null);

    const result = await authenticateAgent(makeRequest("Bearer vf_node_token-id_secret"));
    expect(result).toBeNull();
    expect(verifyNodeTokenMock).not.toHaveBeenCalled();
  });

  it("returns nodeId and environmentId when token matches", async () => {
    extractBearerTokenMock.mockReturnValue("vf_node_token-id_secret");
    getNodeTokenIdentifierMock.mockReturnValue("token-id");
    prismaMock.vectorNode.findUnique.mockResolvedValue({
      id: "node-2",
      environmentId: "env-2",
      nodeTokenHash: "hash-2",
    } as never);
    verifyNodeTokenMock.mockResolvedValueOnce(true);

    const result = await authenticateAgent(makeRequest("Bearer vf_node_token-id_secret"));
    expect(result).toEqual({ nodeId: "node-2", environmentId: "env-2" });
    expect(verifyNodeTokenMock).toHaveBeenCalledWith(
      "vf_node_token-id_secret",
      "hash-2",
    );
  });

  it("returns null when the candidate node hash does not verify", async () => {
    extractBearerTokenMock.mockReturnValue("vf_node_token-id_secret");
    getNodeTokenIdentifierMock.mockReturnValue("token-id");
    prismaMock.vectorNode.findUnique.mockResolvedValue({
      id: "node-1",
      environmentId: "env-1",
      nodeTokenHash: "hash-1",
    } as never);
    verifyNodeTokenMock.mockResolvedValue(false);

    const result = await authenticateAgent(makeRequest("Bearer vf_node_token-id_secret"));
    expect(result).toBeNull();
    expect(verifyNodeTokenMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the candidate node has no token hash", async () => {
    extractBearerTokenMock.mockReturnValue("vf_node_token-id_secret");
    getNodeTokenIdentifierMock.mockReturnValue("token-id");
    prismaMock.vectorNode.findUnique.mockResolvedValue({
      id: "node-1",
      environmentId: "env-1",
      nodeTokenHash: null,
    } as never);
    verifyNodeTokenMock.mockResolvedValue(true);

    const result = await authenticateAgent(makeRequest("Bearer vf_node_token-id_secret"));
    expect(result).toBeNull();
    expect(verifyNodeTokenMock).not.toHaveBeenCalled();
  });

  it("benchmark: does one indexed lookup and one hash verify with 1000+ enrolled nodes", async () => {
    extractBearerTokenMock.mockReturnValue("vf_node_token-id_secret");
    getNodeTokenIdentifierMock.mockReturnValue("token-id");
    prismaMock.vectorNode.findUnique.mockResolvedValue({
      id: "node-1001",
      environmentId: "env-1",
      nodeTokenHash: "hash-1001",
    } as never);
    verifyNodeTokenMock.mockResolvedValue(true);

    const result = await authenticateAgent(makeRequest("Bearer vf_node_token-id_secret"));

    expect(result).toEqual({ nodeId: "node-1001", environmentId: "env-1" });
    expect(prismaMock.vectorNode.findMany).not.toHaveBeenCalled();
    expect(prismaMock.vectorNode.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.vectorNode.findUnique).toHaveBeenCalledWith({
      where: { nodeTokenId: "token-id" },
      select: { id: true, environmentId: true, nodeTokenHash: true },
    });
    expect(verifyNodeTokenMock).toHaveBeenCalledTimes(1);
  });
});
