import net from "node:net";
import { spawnSync } from "node:child_process";

export const DEFAULT_QA_DATABASE_URL =
  "postgresql://vectorflow_e2e:e2e_test_password@127.0.0.1:5433/vectorflow_e2e?schema=public";
export const POSTGRES_REACHABILITY_TIMEOUT_MS = 5000;

export function getQaDatabaseMode(env = process.env, argv = process.argv.slice(2)) {
  if (argv.includes("--local-pg") || env.QA_DATABASE_MODE === "local-pg") {
    return "local-pg";
  }

  if (!env.QA_DATABASE_MODE || env.QA_DATABASE_MODE === "docker") {
    return "docker";
  }

  throw new Error(
    `Unsupported QA_DATABASE_MODE="${env.QA_DATABASE_MODE}". Use "docker" or "local-pg".`,
  );
}

export function getQaDatabaseUrl(env = process.env) {
  return env.DATABASE_URL ?? DEFAULT_QA_DATABASE_URL;
}

export function getPostgresEndpoint(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || "5432"),
  };
}

export function hasDocker() {
  const docker = spawnSync("docker", ["--version"], { stdio: "ignore" });
  if (docker.status !== 0) return false;

  const daemon = spawnSync("docker", ["info"], { stdio: "ignore" });
  return daemon.status === 0;
}

export function isTcpReachable({ host, port }, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (reachable) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export function buildPrerequisiteFailureMessage({
  mode,
  databaseUrl,
  dockerAvailable,
  localPostgresReachable,
}) {
  const { host, port } = getPostgresEndpoint(databaseUrl);

  if (mode === "local-pg") {
    return `
Local PostgreSQL is required for pnpm dev:qa:local-pg, but no PostgreSQL server is reachable at ${host}:${port}.

Start a local or managed development PostgreSQL instance, set DATABASE_URL if needed, then rerun:
  pnpm dev:qa:local-pg

The Prisma schema uses provider = "postgresql"; SQLite is not compatible with this QA path.
`;
  }

  if (!dockerAvailable && !localPostgresReachable) {
    return `
Docker daemon is unreachable and no PostgreSQL server is reachable at ${host}:${port}.

Default path:
  Start Docker Desktop or another Docker daemon, then rerun:
    pnpm dev:qa

Docker-less path:
  Start a local or managed development PostgreSQL instance on the configured DATABASE_URL, then rerun:
    pnpm dev:qa:local-pg

The database container is defined in e2e/docker-compose.e2e.yml and listens on localhost:5433.
The Prisma schema uses provider = "postgresql"; SQLite is not compatible with this QA path.
`;
  }

  return `
Docker daemon is unreachable, so the default pnpm dev:qa path cannot start the Compose PostgreSQL service.

A PostgreSQL server is reachable at ${host}:${port}. To use it explicitly, rerun:
  pnpm dev:qa:local-pg

To keep the default Docker path, start Docker Desktop or another Docker daemon, then rerun:
  pnpm dev:qa
`;
}
