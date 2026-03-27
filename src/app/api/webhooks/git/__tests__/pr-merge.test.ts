import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import crypto from "crypto";

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/crypto", () => ({
  decrypt: vi.fn((val: string) => `decrypted-${val}`),
  encrypt: vi.fn(),
}));

vi.mock("@/server/services/config-crypto", () => ({
  encryptNodeConfig: vi.fn((_: unknown, c: unknown) => c),
  decryptNodeConfig: vi.fn((_: unknown, c: unknown) => c),
}));

vi.mock("@/lib/config-generator", () => ({
  importVectorConfig: vi.fn().mockReturnValue({ nodes: [], edges: [], globalConfig: null }),
  generateVectorYaml: vi.fn(),
}));

vi.mock("@/server/services/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/server/services/promotion-service", () => ({
  executePromotion: vi.fn().mockResolvedValue({ pipelineId: "new-pipe", pipelineName: "My Pipeline" }),
  preflightSecrets: vi.fn(),
  generateDiffPreview: vi.fn(),
}));

vi.mock("@/server/services/gitops-promotion", () => ({
  createPromotionPR: vi.fn(),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { POST } from "../route";
import { prisma } from "@/lib/prisma";
import { executePromotion } from "@/server/services/promotion-service";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Helpers ────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = "test-webhook-secret";
const ENCRYPTED_SECRET = "enc-secret";

function makeHmacSignature(body: string, secret: string): string {
  return (
    "sha256=" + crypto.createHmac("sha256", `decrypted-${secret}`).update(body).digest("hex")
  );
}

function makeEnvironment(overrides: Record<string, unknown> = {}) {
  return {
    id: "env-1",
    name: "Production",
    teamId: "team-1",
    gitOpsMode: "promotion",
    gitWebhookSecret: ENCRYPTED_SECRET,
    gitRepoUrl: "https://github.com/myorg/myrepo",
    gitBranch: "main",
    gitToken: "enc-token",
    requireDeployApproval: false,
    ...overrides,
  };
}

function makePrPayload(overrides: {
  action?: string;
  merged?: boolean;
  body?: string;
} = {}) {
  const { action = "closed", merged = true, body: prBody = "<!-- vf-promotion-request-id: req123abc456 -->\n\nPromoted by VectorFlow." } = overrides;
  return {
    action,
    pull_request: {
      number: 42,
      merged,
      body: prBody,
      html_url: "https://github.com/myorg/myrepo/pull/42",
    },
  };
}

function makeRequest(
  payload: Record<string, unknown>,
  eventType: string,
  signatureOverride?: string,
): Request {
  const body = JSON.stringify(payload);
  const signature = signatureOverride ?? makeHmacSignature(body, ENCRYPTED_SECRET);
  return new Request("http://localhost/api/webhooks/git", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature,
      "X-GitHub-Event": eventType,
    },
    body,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Git webhook — PR merge handler", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("responds pong to ping event without checking signature", async () => {
    const req = new Request("http://localhost/api/webhooks/git", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Event": "ping" },
      body: JSON.stringify({ zen: "Testing is good." }),
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBe("pong");
    expect(prismaMock.environment.findMany).not.toHaveBeenCalled();
  });

  it("returns 401 when signature is missing", async () => {
    prismaMock.environment.findMany.mockResolvedValue([makeEnvironment()] as never);
    const req = new Request("http://localhost/api/webhooks/git", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Event": "pull_request" },
      body: JSON.stringify(makePrPayload()),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 when HMAC signature is invalid", async () => {
    prismaMock.environment.findMany.mockResolvedValue([makeEnvironment()] as never);

    const req = makeRequest(makePrPayload(), "pull_request", "sha256=badbadbadbad");
    const res = await POST(req as never);

    expect(res.status).toBe(401);
  });

  it("includes both promotion and bidirectional environments in HMAC lookup", async () => {
    prismaMock.environment.findMany.mockResolvedValue([] as never);
    prismaMock.promotionRequest.updateMany.mockResolvedValue({ count: 0 } as never);

    const payload = makePrPayload();
    const body = JSON.stringify(payload);
    const signature = makeHmacSignature(body, ENCRYPTED_SECRET);
    const req = new Request("http://localhost/api/webhooks/git", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": signature,
        "X-GitHub-Event": "pull_request",
      },
      body,
    });

    await POST(req as never);

    expect(prismaMock.environment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          gitOpsMode: { in: ["bidirectional", "promotion"] },
        }),
      }),
    );
  });

  it("triggers executePromotion for merged PR with VF promotion ID", async () => {
    prismaMock.environment.findMany.mockResolvedValue([makeEnvironment()] as never);
    prismaMock.promotionRequest.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.promotionRequest.findUnique.mockResolvedValue({
      id: "req123abc456",
      promotedById: "user-1",
    } as never);

    const req = makeRequest(makePrPayload(), "pull_request");
    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.deployed).toBe(true);
    expect(json.promotionRequestId).toBe("req123abc456");
    expect(executePromotion).toHaveBeenCalledWith("req123abc456", "user-1");
  });

  it("uses system as executor when promotedById is null", async () => {
    prismaMock.environment.findMany.mockResolvedValue([makeEnvironment()] as never);
    prismaMock.promotionRequest.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.promotionRequest.findUnique.mockResolvedValue({
      id: "req123abc456",
      promotedById: null,
    } as never);

    const req = makeRequest(makePrPayload(), "pull_request");
    await POST(req as never);

    expect(executePromotion).toHaveBeenCalledWith("req123abc456", "system");
  });

  it("ignores PR closed without merge (merged = false)", async () => {
    prismaMock.environment.findMany.mockResolvedValue([makeEnvironment()] as never);

    const req = makeRequest(makePrPayload({ merged: false }), "pull_request");
    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toContain("closed without merge");
    expect(executePromotion).not.toHaveBeenCalled();
  });

  it("ignores PR opened event (action != closed)", async () => {
    prismaMock.environment.findMany.mockResolvedValue([makeEnvironment()] as never);

    const req = makeRequest(makePrPayload({ action: "opened", merged: false }), "pull_request");
    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toContain("Not a closed event");
    expect(executePromotion).not.toHaveBeenCalled();
  });

  it("ignores PR body without VF promotion ID", async () => {
    prismaMock.environment.findMany.mockResolvedValue([makeEnvironment()] as never);

    const req = makeRequest(
      makePrPayload({ body: "Just a regular PR with no VF ID." }),
      "pull_request",
    );
    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toContain("No VectorFlow promotion ID");
    expect(executePromotion).not.toHaveBeenCalled();
  });

  it("idempotency guard: ignores already-deployed promotion (updateMany count = 0)", async () => {
    prismaMock.environment.findMany.mockResolvedValue([makeEnvironment()] as never);
    prismaMock.promotionRequest.updateMany.mockResolvedValue({ count: 0 } as never);

    const req = makeRequest(makePrPayload(), "pull_request");
    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toContain("already processed");
    expect(executePromotion).not.toHaveBeenCalled();
  });

  it("atomic updateMany checks status = AWAITING_PR_MERGE", async () => {
    prismaMock.environment.findMany.mockResolvedValue([makeEnvironment()] as never);
    prismaMock.promotionRequest.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.promotionRequest.findUnique.mockResolvedValue({
      id: "req123abc456",
      promotedById: "user-1",
    } as never);

    const req = makeRequest(makePrPayload(), "pull_request");
    await POST(req as never);

    expect(prismaMock.promotionRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "req123abc456", status: "AWAITING_PR_MERGE" },
      data: { status: "DEPLOYING" },
    });
  });
});
