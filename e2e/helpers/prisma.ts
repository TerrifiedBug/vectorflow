import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma";

export function createE2EPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required for Playwright e2e setup");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: ["error"],
  });
}
