import { prisma } from "@/lib/prisma";

export interface GroupMapping {
  group: string;
  teamId: string;
  role: "VIEWER" | "EDITOR" | "ADMIN";
}

const ROLE_RANK: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };

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
 * Reconcile a user's team memberships based on their group names.
 *
 * This is the ONLY function that creates, updates, or deletes TeamMembers
 * with source="group_mapping". All SCIM endpoints and OIDC login call this.
 *
 * Algorithm:
 * 1. Load all group mappings
 * 2. For each group the user is in, find mapped teams/roles
 * 3. Compute desired state: Map<teamId, highestRole>
 * 4. Fetch current TeamMembers where source = "group_mapping"
 * 5. Diff desired vs current: create missing, update changed roles, delete stale
 * 6. Never touch source="manual" records
 */
export async function reconcileUserTeamMemberships(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  userGroupNames: string[],
): Promise<void> {
  const allMappings = await loadGroupMappings();
  console.log(`[reconcile] userId=${userId}, userGroups=${JSON.stringify(userGroupNames)}, mappings=${JSON.stringify(allMappings)}`);

  // Compute desired state: for each team, the highest role from any matching group
  const desiredTeamRoles = new Map<string, "VIEWER" | "EDITOR" | "ADMIN">();
  for (const groupName of userGroupNames) {
    for (const mapping of allMappings) {
      if (mapping.group !== groupName) continue;
      const current = desiredTeamRoles.get(mapping.teamId);
      if (!current || (ROLE_RANK[mapping.role] ?? 0) > (ROLE_RANK[current] ?? 0)) {
        desiredTeamRoles.set(mapping.teamId, mapping.role);
      }
    }
  }

  console.log(`[reconcile] desiredTeamRoles=${JSON.stringify([...desiredTeamRoles.entries()])}`);

  // Fetch current group_mapping TeamMembers for this user
  const existing = await tx.teamMember.findMany({
    where: { userId, source: "group_mapping" },
  });
  console.log(`[reconcile] existing group_mapping members=${JSON.stringify(existing.map(m => ({ teamId: m.teamId, role: m.role })))}`);

  const existingByTeam = new Map(existing.map((m) => [m.teamId, m]));

  // Create or update
  for (const [teamId, role] of desiredTeamRoles) {
    const existingMember = existingByTeam.get(teamId);

    if (existingMember) {
      // Update role if changed
      if (existingMember.role !== role) {
        await tx.teamMember.update({
          where: { id: existingMember.id },
          data: { role },
        });
      }
    } else {
      // Check if a manual assignment exists for this user+team
      const manual = await tx.teamMember.findUnique({
        where: { userId_teamId: { userId, teamId } },
      });
      if (manual) {
        // Manual assignment exists — skip (manual is immutable by automation)
        continue;
      }
      await tx.teamMember.create({
        data: { userId, teamId, role, source: "group_mapping" },
      });
    }
  }

  // Delete stale: existing group_mapping members not in desired set
  for (const member of existing) {
    if (!desiredTeamRoles.has(member.teamId)) {
      await tx.teamMember.delete({ where: { id: member.id } });
    }
  }
}

/**
 * Get the group names a user belongs to via ScimGroupMember records.
 */
export async function getScimGroupNamesForUser(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
): Promise<string[]> {
  const memberships = await tx.scimGroupMember.findMany({
    where: { userId },
    include: { scimGroup: { select: { displayName: true } } },
  });
  return memberships.map((m) => m.scimGroup.displayName);
}
