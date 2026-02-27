import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function isSetupRequired(): Promise<boolean> {
  const userCount = await prisma.user.count();
  return userCount === 0;
}

export async function completeSetup(input: {
  email: string;
  name: string;
  password: string;
  teamName: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        authMethod: "LOCAL",
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

    await tx.systemSettings.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    });

    return { user, team };
  });
}
