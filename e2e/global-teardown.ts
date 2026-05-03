import { cleanup } from "./helpers/cleanup";
import { createE2ePrismaClient } from "./helpers/prisma";

export default async function globalTeardown(): Promise<void> {
  const prisma = createE2ePrismaClient();
  try {
    await cleanup(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
