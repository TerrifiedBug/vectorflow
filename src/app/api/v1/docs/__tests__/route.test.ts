import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/auth";
import { GET } from "../route";

function makeRequest(): Request {
  return new Request("https://vf.example.com/api/v1/docs");
}

describe("GET /api/v1/docs", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("adds Subresource Integrity to both jsdelivr swagger assets (VF-20)", async () => {
    const res = await GET(makeRequest());
    const html = await res.text();

    // CSS link carries an sha384 SRI hash + crossorigin
    expect(html).toMatch(
      /swagger-ui\.css"\s+integrity="sha384-[A-Za-z0-9+/]+"\s+crossorigin="anonymous"/,
    );
    // Bundle script carries an sha384 SRI hash + crossorigin
    expect(html).toMatch(
      /swagger-ui-bundle\.js"\s+integrity="sha384-[A-Za-z0-9+/]+"\s+crossorigin="anonymous"/,
    );
  });

  it("hardens the route CSP with frame-ancestors/object-src/base-uri (VF-37)", async () => {
    const res = await GET(makeRequest());
    const csp = res.headers.get("Content-Security-Policy") ?? "";

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});
