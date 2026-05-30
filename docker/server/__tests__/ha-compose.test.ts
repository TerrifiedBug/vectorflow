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

  it("uses 127.0.0.1 for container-local healthchecks (not 'localhost')", () => {
    // /etc/hosts in many base images (incl. alpine) lists ::1 before 127.0.0.1
    // for 'localhost'. Busybox wget tries IPv6 first and fails with
    // "Connection refused" because Next.js/nginx bind to IPv4 0.0.0.0 only.
    // Pinning to 127.0.0.1 avoids the AAAA lookup.
    const healthcheckLines = compose
      .split("\n")
      .filter((l) => l.includes("api/health/ready") && l.trim().startsWith("test:"));
    expect(healthcheckLines.length).toBeGreaterThanOrEqual(3); // vf1, vf2, nginx
    for (const line of healthcheckLines) {
      expect(line).toContain("127.0.0.1:3000");
      expect(line).not.toContain("localhost:3000");
    }
  });

  it("runs migrations once via a dedicated service, not per-replica", () => {
    // Two app replicas each running `prisma migrate deploy` on boot race on the
    // _prisma_migrations advisory lock. The contract is:
    //   - a one-shot `migrate` service applies migrations once and exits
    //   - vf1/vf2 wait for it (service_completed_successfully)
    //   - vf1/vf2 set VF_SKIP_MIGRATIONS=true so they never migrate themselves
    expect(compose).toMatch(/migrate:[\s\S]*command:\s*\["\.\/migrate\.sh"\]/);
    expect(compose).toMatch(/migrate:[\s\S]*restart:\s*"no"/);

    const vf1Block = compose.match(/vf1:[\s\S]*?volumes:/)?.[0] ?? "";
    const vf2Block = compose.match(/vf2:[\s\S]*?volumes:/)?.[0] ?? "";
    for (const block of [vf1Block, vf2Block]) {
      expect(block).toMatch(/migrate:\s*\n\s*condition: service_completed_successfully/);
      expect(block).toMatch(/VF_SKIP_MIGRATIONS:\s*"true"/);
    }
  });

  it("passes POSTGRES_PASSWORD to each replica so the entrypoint can build DATABASE_URL", () => {
    // The compose used to interpolate ${POSTGRES_PASSWORD} directly into
    // DATABASE_URL, which corrupts the URL when the password contains
    // URL-reserved characters (Prisma P1013). The contract is now:
    //   - compose passes raw POSTGRES_PASSWORD to the container
    //   - entrypoint.sh constructs DATABASE_URL with proper URL-encoding
    //   - users overriding DATABASE_URL (external DB) still win
    expect(compose).not.toMatch(
      /DATABASE_URL:\s*postgresql:\/\/vectorflow:\$\{POSTGRES_PASSWORD\}@/,
    );
    const vf1Env = compose.match(/vf1:[\s\S]*?volumes:/)?.[0] ?? "";
    const vf2Env = compose.match(/vf2:[\s\S]*?volumes:/)?.[0] ?? "";
    expect(vf1Env).toMatch(/POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD\}/);
    expect(vf2Env).toMatch(/POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD\}/);
  });
});
