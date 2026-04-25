import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { ulid } from "ulid";

function buildTelemetryFields(choice: "yes" | "no") {
  if (choice === "yes") {
    return {
      telemetryEnabled: true,
      telemetryInstanceId: ulid(),
      telemetryEnabledAt: new Date(),
    };
  }
  return {
    telemetryEnabled: false,
    telemetryInstanceId: null,
    telemetryEnabledAt: null,
  };
}

export async function isSetupRequired(): Promise<boolean> {
  const userCount = await prisma.user.count();
  return userCount === 0;
}

export async function completeSetup(input: {
  email: string;
  name: string;
  password: string;
  teamName: string;
  telemetryChoice: "yes" | "no";
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        authMethod: "LOCAL",
        isSuperAdmin: true,
      },
    });

    const team = await tx.team.create({
      data: { name: input.teamName },
    });

    await tx.teamMember.create({
      data: {
        userId: user.id,
        teamId: team.id,
        role: "ADMIN",
      },
    });

    const telemetryFields = buildTelemetryFields(input.telemetryChoice);

    await tx.systemSettings.upsert({
      where: { id: "singleton" },
      update: telemetryFields,
      create: { id: "singleton", ...telemetryFields },
    });

    return { user, team };
  });
}
