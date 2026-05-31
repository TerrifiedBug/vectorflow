import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithOrgContext } from "@/lib/org-context";
import { withOrgTx } from "@/lib/with-org-tx";
import type { Prisma } from "@/generated/prisma";
import { fireScimSyncFailedAlert, writeScimAuditLog } from "@/server/services/scim";
import { debugLog } from "@/lib/logger";
import { authenticateScim } from "../auth";
import {
  reconcileUserTeamMemberships,
  getScimGroupNamesForUser,
} from "@/server/services/group-mappings";

interface ScimGroupResponse {
  schemas: string[];
  id: string;
  displayName: string;
  members: Array<{ value: string; display?: string }>;
}

function toScimGroupResponse(
  group: { id: string; displayName: string; externalId?: string | null },
  members: Array<{ value: string; display?: string }> = [],
): ScimGroupResponse & { externalId?: string } {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: group.id,
    ...(group.externalId ? { externalId: group.externalId } : {}),
    displayName: group.displayName,
    members,
  };
}

function scimError(detail: string, status: number) {
  return NextResponse.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail,
      status: String(status),
    },
    { status },
  );
}

export async function GET(req: NextRequest) {
  const auth = await authenticateScim(req);
  if (!auth.ok) {
    return scimError("Unauthorized", 401);
  }

  return runWithOrgContext(auth.organizationId, async () => {
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") ?? undefined;
    const startIndexRaw = parseInt(url.searchParams.get("startIndex") ?? "1");
    const countRaw = parseInt(url.searchParams.get("count") ?? "100");
    const startIndex =
      Number.isFinite(startIndexRaw) && startIndexRaw >= 1 ? startIndexRaw : 1;
    const count =
      Number.isFinite(countRaw) && countRaw >= 1
        ? Math.min(countRaw, 1000)
        : 100;

    const where: Record<string, unknown> = { organizationId: auth.organizationId };
    if (filter) {
      const nameMatch = filter.match(/displayName\s+eq\s+"(.+?)"/);
      if (nameMatch) where.displayName = nameMatch[1];
    }

    const [groups, total] = await Promise.all([
      prisma.scimGroup.findMany({
        where,
        skip: startIndex - 1,
        take: count,
        orderBy: { createdAt: "asc" },
        include: {
          members: { select: { userId: true, user: { select: { email: true } } } },
        },
      }),
      prisma.scimGroup.count({ where }),
    ]);

    return NextResponse.json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: total,
      startIndex,
      itemsPerPage: count,
      Resources: groups.map((g) =>
        toScimGroupResponse(
          g,
          g.members.map((m) => ({ value: m.userId, display: m.user.email })),
        ),
      ),
    });
  });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateScim(req);
  if (!auth.ok) {
    return scimError("Unauthorized", 401);
  }

  return runWithOrgContext(auth.organizationId, async () => {
    let displayNameForAudit = "unknown";
    let failureAction:
      | "scim.group_created"
      | "scim.group_adopted"
      | "scim.group_updated" = "scim.group_created";

    try {
      const body = await req.json();
      debugLog("scim", `POST /Groups`, { displayName: body.displayName, memberCount: Array.isArray(body.members) ? body.members.length : 0 });
      const displayName = body.displayName;
      displayNameForAudit = typeof displayName === "string" ? displayName : "unknown";
      if (!displayName || typeof displayName !== "string") {
        return scimError("displayName is required", 400);
      }

      const { group, memberResponses, auditAction } = await withOrgTx(auth.organizationId, async (tx) => {
        // Adoption is scoped per-org: composite uniqueness (orgId, displayName)
        // means the same displayName can exist in peer orgs without collision.
        const existing = await tx.scimGroup.findUnique({
          where: {
            organizationId_displayName: {
              organizationId: auth.organizationId,
              displayName,
            },
          },
        });

        let scimGroup;
        let action: "scim.group_created" | "scim.group_adopted" | null = null;

        if (existing) {
          scimGroup = existing;
          failureAction =
            body.externalId && body.externalId !== existing.externalId
              ? "scim.group_adopted"
              : "scim.group_updated";
          if (body.externalId && body.externalId !== existing.externalId) {
            scimGroup = await tx.scimGroup.update({
              where: { id: existing.id },
              data: { externalId: body.externalId },
            });
            action = "scim.group_adopted";
          }
          // If nothing changed, skip audit (avoids flooding on every sync cycle)
        } else {
          scimGroup = await tx.scimGroup.create({
            data: {
              organizationId: auth.organizationId,
              displayName,
              externalId: body.externalId ?? null,
            },
          });
          action = "scim.group_created";
        }

        const members = await processGroupMembers(tx, scimGroup.id, body.members, auth.organizationId);

        return { group: scimGroup, memberResponses: members, auditAction: action };
      });

      if (auditAction) {
        await writeScimAuditLog({
          action: auditAction,
          entityType: "ScimGroup",
          entityId: group.id,
          metadata: { displayName },
          status: "success",
        });
      }

      return NextResponse.json(
        toScimGroupResponse(group, memberResponses),
        { status: auditAction === "scim.group_created" ? 201 : 200 },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create group";
      await writeScimAuditLog({
        action: failureAction,
        entityType: "ScimGroup",
        entityId: displayNameForAudit,
        metadata: { displayName: displayNameForAudit },
        status: "failure",
        error,
      });
      void fireScimSyncFailedAlert(message);
      return scimError(message, 400);
    }
  });
}

/**
 * Create ScimGroupMember records for members in a group POST/PUT,
 * then reconcile each user's team memberships.
 * Accepts a transaction client so the caller can wrap group creation
 * and member processing in a single atomic transaction.
 */
async function processGroupMembers(
  tx: Prisma.TransactionClient,
  scimGroupId: string,
  members: unknown,
  organizationId: string,
): Promise<Array<{ value: string; display?: string }>> {
  if (!Array.isArray(members) || members.length === 0) return [];

  const results: Array<{ value: string; display?: string }> = [];

  for (const member of members) {
    const userId = (member as { value?: unknown }).value;
    if (typeof userId !== "string") continue;

    // Cross-tenant guard: only resolve users who are already members of
    // this SCIM caller's org. A POST that names a userId from a peer
    // org silently skips that member rather than provisioning it.
    const user = await tx.user.findFirst({
      where: {
        id: userId,
        orgMemberships: { some: { organizationId } },
      },
      select: { id: true, email: true },
    });
    if (!user) continue;

    await tx.scimGroupMember.upsert({
      where: { scimGroupId_userId: { scimGroupId, userId } },
      create: { scimGroupId, userId },
      update: {},
    });

    const groupNames = await getScimGroupNamesForUser(tx, userId, organizationId);
    await reconcileUserTeamMemberships(tx, userId, groupNames, organizationId);

    results.push({ value: userId, display: user.email });
  }

  return results;
}
