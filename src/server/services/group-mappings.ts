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

const ROLE_RANK: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };

/**
 * Apply team memberships for a user based on group mappings.
 * Creates TeamMember records or upgrades roles, but never downgrades —
 * without provenance tracking we can't know if a higher role was granted
 * by another group, OIDC login, or manual assignment.
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
    } else if ((ROLE_RANK[mapping.role] ?? 0) > (ROLE_RANK[existing.role] ?? 0)) {
      await tx.teamMember.update({
        where: { id: existing.id },
        data: { role: mapping.role },
      });
    }
  }
}

