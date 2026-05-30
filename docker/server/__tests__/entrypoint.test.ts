import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "fs";
import { spawnSync } from "child_process";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Drive the real entrypoint.sh against a temp cwd that contains a stub
// `server.js`. PATH is prepended with a stub `prisma` so migration is a
// no-op; node itself is the real one (the entrypoint URL-encoder needs it).

const ENTRYPOINT = resolve("docker/server/entrypoint.sh");

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
  /** DATABASE_URL the entrypoint built (or passed through). */
  databaseUrl: string | null;
}

function runEntrypoint(env: Record<string, string | undefined>): Result {
  const work = mkdtempSync(join(tmpdir(), "vf-entrypoint-"));
  try {
    writeFileSync(
      join(work, "prisma"),
      `#!/bin/sh\nprintf 'STUB_PRISMA_DATABASE_URL=%s\\n' "$DATABASE_URL"\nexit 0\n`,
    );
    writeFileSync(
      join(work, "server.js"),
      `process.stdout.write('STUB_SERVER_DATABASE_URL=' + (process.env.DATABASE_URL ?? '') + '\\n');\n`,
    );
    chmodSync(join(work, "prisma"), 0o755);

    const result = spawnSync("sh", [ENTRYPOINT], {
      cwd: work,
      env: {
        // Bare minimum so node + sh + coreutils still resolve.
        PATH: `${work}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        ...env,
        // Strict @types/node typings require NODE_ENV on ProcessEnv; this
        // suite doesn't care what it is, only that the cast satisfies tsc.
      } as unknown as NodeJS.ProcessEnv,
      encoding: "utf-8",
    });

    const stdout = result.stdout ?? "";
    const match = stdout.match(/STUB_SERVER_DATABASE_URL=(.*)/);
    return {
      status: result.status,
      stdout,
      stderr: result.stderr ?? "",
      databaseUrl: match ? match[1] : null,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe("entrypoint.sh DATABASE_URL construction", () => {
  it("builds DATABASE_URL from POSTGRES_PASSWORD with defaults", () => {
    const r = runEntrypoint({ POSTGRES_PASSWORD: "simplepw" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.databaseUrl).toBe(
      "postgresql://vectorflow:simplepw@postgres:5432/vectorflow",
    );
  });

  it("percent-encodes /, +, = (the openssl rand -base64 footgun)", () => {
    // The exact payload that triggered Prisma P1013 in production.
    const r = runEntrypoint({
      POSTGRES_PASSWORD: "oav4mG/6njhtLF7K+D2OOStiJIGU9OXSsNubreyNSsM=",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.databaseUrl).toBe(
      "postgresql://vectorflow:oav4mG%2F6njhtLF7K%2BD2OOStiJIGU9OXSsNubreyNSsM%3D@postgres:5432/vectorflow",
    );
  });

  it("percent-encodes @, :, ?, #, % in the password", () => {
    const r = runEntrypoint({ POSTGRES_PASSWORD: "p@ss:wo?rd#1%2" });
    expect(r.status, r.stderr).toBe(0);
    // encodeURIComponent: @ → %40, : → %3A, ? → %3F, # → %23, % → %25
    expect(r.databaseUrl).toBe(
      "postgresql://vectorflow:p%40ss%3Awo%3Frd%231%252@postgres:5432/vectorflow",
    );
  });

  it("respects POSTGRES_USER / POSTGRES_HOST / POSTGRES_PORT / POSTGRES_DB overrides", () => {
    const r = runEntrypoint({
      POSTGRES_PASSWORD: "pw",
      POSTGRES_USER: "alice",
      POSTGRES_HOST: "db.internal",
      POSTGRES_PORT: "6543",
      POSTGRES_DB: "shop",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.databaseUrl).toBe("postgresql://alice:pw@db.internal:6543/shop");
  });

  it("brackets bare IPv6 literal hosts so host:port parses", () => {
    // RFC 3986 §3.2.2: IP-literal in URIs is "[" IPv6address "]". Without
    // brackets, `postgresql://...@2001:db8::1:5432/...` is ambiguous and
    // Prisma rejects it.
    const r = runEntrypoint({
      POSTGRES_PASSWORD: "pw",
      POSTGRES_HOST: "2001:db8::1",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.databaseUrl).toBe(
      "postgresql://vectorflow:pw@[2001:db8::1]:5432/vectorflow",
    );
  });

  it("does not double-bracket IPv6 hosts the user already bracketed", () => {
    const r = runEntrypoint({
      POSTGRES_PASSWORD: "pw",
      POSTGRES_HOST: "[fe80::1]",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.databaseUrl).toBe(
      "postgresql://vectorflow:pw@[fe80::1]:5432/vectorflow",
    );
  });

  it("passes DATABASE_URL through unchanged when explicitly set", () => {
    // External-Postgres override: user supplied a fully-formed URL; the
    // entrypoint must not second-guess it (e.g. they may already have
    // percent-encoded the password themselves).
    const explicit =
      "postgresql://alice:already%2Fencoded@db.example.com:5432/shop";
    const r = runEntrypoint({ DATABASE_URL: explicit });
    expect(r.status, r.stderr).toBe(0);
    expect(r.databaseUrl).toBe(explicit);
  });

  it("fails fast when neither DATABASE_URL nor POSTGRES_PASSWORD is set", () => {
    const r = runEntrypoint({});
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/DATABASE_URL or POSTGRES_PASSWORD/);
  });
});

describe("entrypoint.sh migration gating (VF_SKIP_MIGRATIONS)", () => {
  // The stub prisma echoes STUB_PRISMA_DATABASE_URL=... only when it is invoked,
  // so its presence/absence in stdout tells us whether migrations ran.
  it("runs migrations by default (single-instance / docker compose)", () => {
    const r = runEntrypoint({ POSTGRES_PASSWORD: "pw" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("Running database migrations...");
    expect(r.stdout).toMatch(/STUB_PRISMA_DATABASE_URL=/);
    // Server still starts after migrating.
    expect(r.stdout).toMatch(/STUB_SERVER_DATABASE_URL=/);
  });

  it("skips migrations when VF_SKIP_MIGRATIONS=true (HA replicas)", () => {
    const r = runEntrypoint({
      POSTGRES_PASSWORD: "pw",
      VF_SKIP_MIGRATIONS: "true",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("Skipping database migrations");
    // prisma must NOT have been invoked.
    expect(r.stdout).not.toMatch(/STUB_PRISMA_DATABASE_URL=/);
    // Server still starts.
    expect(r.stdout).toMatch(/STUB_SERVER_DATABASE_URL=/);
  });

  it("still migrates when VF_SKIP_MIGRATIONS is set to a non-'true' value", () => {
    const r = runEntrypoint({
      POSTGRES_PASSWORD: "pw",
      VF_SKIP_MIGRATIONS: "false",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/STUB_PRISMA_DATABASE_URL=/);
  });
});
