import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("HA Docker Compose readiness", () => {
  const compose = readFileSync(
    resolve("docker/server/docker-compose.ha.yml"),
    "utf-8",
  );
  const nginx = readFileSync(
    resolve("docker/server/nginx-ha.conf"),
    "utf-8",
  );

  it("checks readiness on both app replicas and nginx", () => {
    expect(compose).toMatch(/vf1:[\s\S]*healthcheck:[\s\S]*api\/health\/ready/);
    expect(compose).toMatch(/vf2:[\s\S]*healthcheck:[\s\S]*api\/health\/ready/);
    expect(compose).toMatch(/nginx:[\s\S]*healthcheck:[\s\S]*api\/health\/ready/);
  });

  it("starts nginx after either app replica is ready", () => {
    expect(compose).toContain("Waiting for at least one VectorFlow replica");
    expect(compose).toContain("http://vf1:3000/api/health/ready \\");
    expect(compose).toContain("http://vf2:3000/api/health/ready");
    expect(compose).toMatch(/vf1:[\s\S]*condition: service_started/);
    expect(compose).toMatch(/vf2:[\s\S]*condition: service_started/);
  });

  it("retries unready upstreams against the other replica", () => {
    expect(nginx).toContain("server vf1:3000 max_fails=1 fail_timeout=10s;");
    expect(nginx).toContain("server vf2:3000 max_fails=1 fail_timeout=10s;");
    expect(nginx).toContain("proxy_next_upstream error timeout http_502 http_503 http_504;");
    expect(nginx).toContain("proxy_next_upstream_tries 2;");
  });
});
