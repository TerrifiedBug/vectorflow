#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  buildPrerequisiteFailureMessage,
  buildQaDevEnv,
  getPostgresEndpoint,
  getQaDatabaseMode,
  getQaDatabaseUrl,
  hasDocker,
  isTcpReachable,
  POSTGRES_REACHABILITY_TIMEOUT_MS,
} from "./dev-qa-lib.mjs";

const QA_DEV_USER = {
  id: "qa-user",
  email: "qa@vectorflow.local",
  name: "QA Dev User",
};

// Local QA runner: starts the e2e PostgreSQL Compose service, applies Prisma
// migrations, seeds deterministic QA data, then launches Next.js with the
// local dev auth bypass. Exposed publicly as `pnpm dev:qa`.
const mode = getQaDatabaseMode();
const DATABASE_URL = getQaDatabaseUrl();

const env = buildQaDevEnv(process.env, DATABASE_URL, QA_DEV_USER);

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

if (env.NODE_ENV === "production") {
  console.error("Refusing to start QA dev auth bypass with NODE_ENV=production.");
  process.exit(1);
}

const dockerAvailable = mode === "docker" ? hasDocker() : false;
const localPostgresReachable = await isTcpReachable(
  getPostgresEndpoint(DATABASE_URL),
  POSTGRES_REACHABILITY_TIMEOUT_MS,
);

if (mode === "docker" && !dockerAvailable) {
  console.error(
    buildPrerequisiteFailureMessage({
      mode,
      databaseUrl: DATABASE_URL,
      dockerAvailable,
      localPostgresReachable,
    }),
  );
  process.exit(1);
}

if (mode === "local-pg" && !localPostgresReachable) {
  console.error(
    buildPrerequisiteFailureMessage({
      mode,
      databaseUrl: DATABASE_URL,
      dockerAvailable,
      localPostgresReachable,
    }),
  );
  process.exit(1);
}

if (mode === "docker") {
  run("docker", ["compose", "-f", "e2e/docker-compose.e2e.yml", "up", "-d", "--wait"]);
}

run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
run("pnpm", ["seed:qa"]);

console.warn(
  "[auth] DEV_AUTH_BYPASS=1 is enabled for pnpm dev:qa. Do not use this mode outside local development.",
);

run("pnpm", ["exec", "next", "dev", "-p", String(env.PORT ?? "3000")]);
