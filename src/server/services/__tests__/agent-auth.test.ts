import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("../agent-token", () => ({
  extractBearerToken: vi.fn(),
  verifyNodeToken: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { extractBearerToken, verifyNodeToken } from "../agent-token";
import { authenticateAgent } from "../agent-auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const extractBearerTokenMock = extractBearerToken as ReturnType<typeof vi.fn>;
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
  });

  it("returns null when no nodes have token hashes", async () => {
    extractBearerTokenMock.mockReturnValue("vf_node_abc123");
    prismaMock.vectorNode.findMany.mockResolvedValue([]);

    const result = await authenticateAgent(makeRequest("Bearer vf_node_abc123"));
    expect(result).toBeNull();
  });

  it("returns null when token matches no nodes", async () => {
    extractBearerTokenMock.mockReturnValue("vf_node_abc123");
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "node-1", environmentId: "env-1", nodeTokenHash: "hash-1" },
      { id: "node-2", environmentId: "env-2", nodeTokenHash: "hash-2" },
    ] as never);
    verifyNodeTokenMock.mockResolvedValue(false);

    const result = await authenticateAgent(makeRequest("Bearer vf_node_abc123"));
    expect(result).toBeNull();
    expect(verifyNodeTokenMock).toHaveBeenCalledTimes(2);
  });

  it("returns nodeId and environmentId when token matches", async () => {
    extractBearerTokenMock.mockReturnValue("vf_node_abc123");
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "node-1", environmentId: "env-1", nodeTokenHash: "hash-1" },
      { id: "node-2", environmentId: "env-2", nodeTokenHash: "hash-2" },
    ] as never);
    verifyNodeTokenMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const result = await authenticateAgent(makeRequest("Bearer vf_node_abc123"));
    expect(result).toEqual({ nodeId: "node-2", environmentId: "env-2" });
  });

  it("stops checking after first match", async () => {
    extractBearerTokenMock.mockReturnValue("vf_node_abc123");
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "node-1", environmentId: "env-1", nodeTokenHash: "hash-1" },
      { id: "node-2", environmentId: "env-2", nodeTokenHash: "hash-2" },
    ] as never);
    verifyNodeTokenMock.mockResolvedValueOnce(true);

    await authenticateAgent(makeRequest("Bearer vf_node_abc123"));
    expect(verifyNodeTokenMock).toHaveBeenCalledTimes(1);
  });

  it("skips nodes with null nodeTokenHash", async () => {
    extractBearerTokenMock.mockReturnValue("vf_node_abc123");
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "node-1", environmentId: "env-1", nodeTokenHash: null },
      { id: "node-2", environmentId: "env-2", nodeTokenHash: "hash-2" },
    ] as never);
    verifyNodeTokenMock.mockResolvedValue(true);

    const result = await authenticateAgent(makeRequest("Bearer vf_node_abc123"));
    expect(result).toEqual({ nodeId: "node-2", environmentId: "env-2" });
    expect(verifyNodeTokenMock).toHaveBeenCalledTimes(1);
  });
});
