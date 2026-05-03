import { createE2EPrismaClient } from "./helpers/prisma";
import { cleanup } from "./helpers/cleanup";

export default async function globalTeardown(): Promise<void> {
  const prisma = createE2EPrismaClient();

  try {
    await cleanup(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
