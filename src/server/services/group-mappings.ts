import { prisma } from "@/lib/prisma";

interface GroupMapping {
  group: string;
  teamId: string;
  role: "VIEWER" | "EDITOR" | "ADMIN";
}

/**
 * Load all group-to-team mappings from SystemSettings.
 */
export async function loadGroupMappings(): Promise<GroupMapping[]> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: { oidcTeamMappings: true },
  });

  if (!settings?.oidcTeamMappings) return [];

  try {
    const raw = JSON.parse(settings.oidcTeamMappings) as Array<{
      group: string;
      teamId: string;
      role: string;
    }>;
    return raw.filter(
      (m) =>
        m.group &&
        m.teamId &&
        (m.role === "VIEWER" || m.role === "EDITOR" || m.role === "ADMIN"),
    ) as GroupMapping[];
  } catch {
    return [];
  }
}

/**
 * Get mappings for a specific group name.
 */
export function getMappingsForGroup(
  mappings: GroupMapping[],
  groupName: string,
): GroupMapping[] {
  return mappings.filter((m) => m.group === groupName);
}

/**
 * Apply team memberships for a user based on group mappings.
 * Creates or updates TeamMember records for each mapped team.
 */
export async function applyMappedMemberships(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  groupMappings: GroupMapping[],
): Promise<void> {
  for (const mapping of groupMappings) {
    const existing = await tx.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId: mapping.teamId } },
    });
    if (!existing) {
      await tx.teamMember.create({
        data: { userId, teamId: mapping.teamId, role: mapping.role },
      });
    } else if (existing.role !== mapping.role) {
      await tx.teamMember.update({
        where: { id: existing.id },
        data: { role: mapping.role },
      });
    }
  }
}

