import { prisma } from "@/lib/prisma";

export async function GET() {
  const checks: Record<string, "ok" | "error"> = {
    database: "error",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    // database unreachable
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  return Response.json(
    { status: allOk ? "ok" : "error", checks },
    { status: allOk ? 200 : 503 },
  );
}
