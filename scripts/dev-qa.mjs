#!/usr/bin/env node

import { spawnSync } from "node:child_process";

// Internal QA runner: starts the e2e PostgreSQL Compose service, applies Prisma
// migrations, seeds deterministic QA data, then launches Next.js with the local
// dev auth bypass. Keep setup notes in PR context rather than public docs.
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://vectorflow_e2e:e2e_test_password@127.0.0.1:5433/vectorflow_e2e?schema=public";

const env = {
  ...process.env,
  DATABASE_URL,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "qa-dev-nextauth-secret-at-least-16",
  NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "http://localhost:3000",
  NODE_ENV: "development",
  DEV_AUTH_BYPASS: "1",
  DEV_AUTH_BYPASS_USER_ID: process.env.DEV_AUTH_BYPASS_USER_ID ?? "qa-user",
  DEV_AUTH_BYPASS_USER_EMAIL: process.env.DEV_AUTH_BYPASS_USER_EMAIL ?? "qa@vectorflow.local",
  DEV_AUTH_BYPASS_USER_NAME: process.env.DEV_AUTH_BYPASS_USER_NAME ?? "QA Dev User",
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function hasDocker() {
  const docker = spawnSync("docker", ["--version"], { stdio: "ignore" });
  if (docker.status !== 0) return false;

  const daemon = spawnSync("docker", ["info"], { stdio: "ignore" });
  return daemon.status === 0;
}

if (env.NODE_ENV === "production") {
  console.error("Refusing to start QA dev auth bypass with NODE_ENV=production.");
  process.exit(1);
}

if (!hasDocker()) {
  console.error(`
Docker is required for pnpm dev:qa because this repository uses PostgreSQL-only Prisma models.

Start Docker Desktop or another Docker daemon, then rerun:
  pnpm dev:qa

The database container is defined in e2e/docker-compose.e2e.yml and listens on localhost:5433.
`);
  process.exit(1);
}

run("docker", ["compose", "-f", "e2e/docker-compose.e2e.yml", "up", "-d", "--wait"]);
run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
run("pnpm", ["seed:qa"]);

console.warn(
  "[auth] DEV_AUTH_BYPASS=1 is enabled for pnpm dev:qa. Do not use this mode outside local development.",
);

run("pnpm", ["exec", "next", "dev", "-p", "3000"]);
