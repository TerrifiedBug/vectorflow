import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/_lib/ip-rate-limit", () => ({
  checkTokenRateLimit: vi.fn(() => null),
}));

vi.mock("@/server/services/agent-auth", () => ({
  authenticateAgent: vi.fn(() => null),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/logger", () => ({
  errorLog: vi.fn(),
}));

import { checkTokenRateLimit } from "@/app/api/_lib/ip-rate-limit";
import { POST } from "../route";

describe("agent samples rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks a token-aware rate limit before authenticating sample results", async () => {
    const request = new Request("http://localhost/api/agent/samples", {
      method: "POST",
      headers: { authorization: "Bearer token-a" },
    });

    await POST(request);

    expect(checkTokenRateLimit).toHaveBeenCalledWith(request, "agent-samples", 60);
  });

  it("returns the rate-limit response when the samples limit is exceeded", async () => {
    const rateLimitResponse = new Response("too many", { status: 429 });
    vi.mocked(checkTokenRateLimit).mockReturnValueOnce(rateLimitResponse);

    const request = new Request("http://localhost/api/agent/samples", {
      method: "POST",
      headers: { authorization: "Bearer token-a" },
    });

    const response = await POST(request);

    expect(response).toBe(rateLimitResponse);
  });
});
