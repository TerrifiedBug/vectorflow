#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  buildPrerequisiteFailureMessage,
  getPostgresEndpoint,
  getQaDatabaseMode,
  getQaDatabaseUrl,
  hasDocker,
  isTcpReachable,
} from "./dev-qa-lib.mjs";

const QA_DEV_USER = {
  id: "qa-user",
  email: "qa@vectorflow.local",
  name: "QA Dev User",
};

// Internal QA runner: starts the e2e PostgreSQL Compose service, applies Prisma
// migrations, seeds deterministic QA data, then launches Next.js with the local
// dev auth bypass. Keep setup notes in PR context rather than public docs.
const mode = getQaDatabaseMode();
const DATABASE_URL = getQaDatabaseUrl();

const env = {
  ...process.env,
  DATABASE_URL,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "qa-dev-nextauth-secret-at-least-16",
  NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "http://localhost:3000",
  NODE_ENV: "development",
  DEV_AUTH_BYPASS: "1",
  DEV_AUTH_BYPASS_USER_ID: QA_DEV_USER.id,
  DEV_AUTH_BYPASS_USER_EMAIL: QA_DEV_USER.email,
  DEV_AUTH_BYPASS_USER_NAME: QA_DEV_USER.name,
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

if (env.NODE_ENV === "production") {
  console.error("Refusing to start QA dev auth bypass with NODE_ENV=production.");
  process.exit(1);
}

const dockerAvailable = mode === "docker" ? hasDocker() : false;
const localPostgresReachable = await isTcpReachable(getPostgresEndpoint(DATABASE_URL));

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

run("pnpm", ["exec", "next", "dev", "-p", "3000"]);
