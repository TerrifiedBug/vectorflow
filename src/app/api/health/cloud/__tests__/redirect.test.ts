import { describe, it, expect } from "vitest";

import { GET, HEAD } from "../route";

function probe(path: string): Request {
  return new Request(`http://localhost:3000${path}`, { method: "GET" });
}

describe("/api/health/cloud — 308 redirect to /api/health/deep", () => {
  it("redirects GET with 308 preserving the path", async () => {
    const res = await GET(probe("/api/health/cloud"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/api/health/deep",
    );
  });

  it("redirects HEAD with 308", async () => {
    const res = await HEAD(probe("/api/health/cloud"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/api/health/deep",
    );
  });

  it("preserves the query string when present", async () => {
    const res = await GET(probe("/api/health/cloud?verbose=1"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/api/health/deep?verbose=1",
    );
  });
});
