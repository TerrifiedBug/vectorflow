import { PrismaClient } from "../src/generated/prisma";
import { cleanup } from "./helpers/cleanup";

export default async function globalTeardown(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await cleanup(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
