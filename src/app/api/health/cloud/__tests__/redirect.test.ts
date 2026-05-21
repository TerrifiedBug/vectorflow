import { describe, it, expect } from "vitest";

import { GET, HEAD } from "../route";

function probe(path: string): Request {
  return new Request(`http://localhost:3000${path}`, { method: "GET" });
}

describe("/api/health/cloud — 308 redirect to /api/health/deep", () => {
  it("redirects GET with 308 to a relative path", async () => {
    const res = GET(probe("/api/health/cloud"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/api/health/deep");
  });

  it("redirects HEAD with 308 to a relative path", async () => {
    const res = HEAD(probe("/api/health/cloud"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/api/health/deep");
  });

  it("preserves the query string when present", async () => {
    const res = GET(probe("/api/health/cloud?verbose=1"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/api/health/deep?verbose=1");
  });

  it("never echoes the listening socket address into Location", async () => {
    // Simulate Next.js's behaviour inside a container: request.url is
    // built from the bound socket (`0.0.0.0:3000`), not the proxied
    // Host: header. The redirect MUST NOT leak that authority.
    const res = GET(
      new Request("http://0.0.0.0:3000/api/health/cloud", { method: "GET" }),
    );
    expect(res.headers.get("location")).not.toContain("0.0.0.0");
    expect(res.headers.get("location")).toBe("/api/health/deep");
  });
});
