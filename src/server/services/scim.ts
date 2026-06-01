import { prisma } from "@/lib/prisma";
import { withOrgTx } from "@/lib/with-org-tx";
import { writeAuditLog } from "@/server/services/audit";
import { fireEventAlert } from "./event-alerts";
import { debugLog } from "@/lib/logger";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// SCIM 2.0 User resource format
interface ScimUser {
  schemas: string[];
  id?: string;
  externalId?: string;
  userName: string;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  emails?: Array<{ value: string; primary?: boolean; type?: string }>;
  active?: boolean;
  groups?: Array<{ value: string; display?: string }>;
}

interface ScimPatchOp {
  op: string;
  path?: string;
  value?: unknown;
}

/**
 * Thrown when a SCIM mutation targets a membership the IdP must not manage: a
 * LOCAL member (created via signup / invite — including the founding OWNER) or
 * an organization OWNER. SCIM-provisioned and local users coexist; the IdP is
 * authoritative only over the identities it provisions. The SCIM route maps
 * this to HTTP 403 WITHOUT firing a sync-failed alert — it is a policy refusal,
 * not a sync error.
 */
export class ScimProtectedMemberError extends Error {
  readonly _tag = "ScimProtectedMemberError" as const;
  constructor(
    public readonly reason: "local_member" | "owner",
    message: string,
  ) {
    super(message);
    this.name = "ScimProtectedMemberError";
  }
}

function toScimUser(user: {
  id: string;
  email: string;
  name: string | null;
  scimExternalId: string | null;
  lockedAt: Date | null;
}): ScimUser {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id,
    externalId: user.scimExternalId ?? undefined,
    userName: user.email,
    name: { formatted: user.name ?? undefined },
    emails: [{ value: user.email, primary: true, type: "work" }],
    active: !user.lockedAt,
    groups: [],
  };
}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  scimExternalId: true,
  lockedAt: true,
} as const;

type ScimAuditStatus = "success" | "failure";

export async function writeScimAuditLog(params: {
  action: string;
  entityType: "ScimUser" | "ScimGroup";
  entityId: string;
  metadata?: Record<string, unknown>;
  status: ScimAuditStatus;
  error?: unknown;
}) {
  const errorMessage =
    params.error instanceof Error
      ? params.error.message
      : typeof params.error === "string"
        ? params.error
        : undefined;

  await writeAuditLog({
    userId: null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    metadata: {
      ...params.metadata,
      status: params.status,
      ...(errorMessage ? { error: errorMessage } : {}),
    },
  });
}

/**
 * List users belonging to `organizationId` (via OrgMember). Cross-tenant
 * listing is impossible because we always join through OrgMember.
 *
 */
export async function scimListUsers(
  organizationId: string,
  filter?: string,
  startIndex = 1,
  count = 100,
) {
  // Parse simple SCIM filter like 'userName eq "john@example.com"'
  const userWhere: Record<string, unknown> = {
    orgMemberships: {
      some: { organizationId },
    },
  };
  if (filter) {
    const userNameMatch = filter.match(/userName\s+eq\s+"(.+?)"/);
    if (userNameMatch) userWhere.email = userNameMatch[1];
    const extIdMatch = filter.match(/externalId\s+eq\s+"(.+?)"/);
    if (extIdMatch) userWhere.scimExternalId = extIdMatch[1];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      skip: startIndex - 1,
      take: count,
      select: USER_SELECT,
    }),
    prisma.user.count({ where: userWhere }),
  ]);

  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: total,
    startIndex,
    itemsPerPage: count,
    Resources: users.map(toScimUser),
  };
}

export async function scimGetUser(organizationId: string, id: string) {
  const user = await prisma.user.findFirst({
    where: {
      id,
      orgMemberships: { some: { organizationId } },
    },
    select: USER_SELECT,
  });
  if (!user) return null;
  return toScimUser(user);
}

/**
 * Create or adopt a User and bind them to `organizationId` via OrgMember.
 *
 * A pre-existing global User is adopted only when their authMethod is
 * already SSO-compatible OR a previous SCIM token has linked them. The
 * caller's `organizationId` is the only org the new OrgMember is added
 * to — cross-tenant provisioning is structurally impossible.
 */
export async function scimCreateUser(
  organizationId: string,
  scimUser: ScimUser,
): Promise<{ user: ScimUser; adopted: boolean }> {
  const email =
    scimUser.emails?.[0]?.value ?? scimUser.userName;
  const name =
    scimUser.name?.formatted ??
    scimUser.name?.givenName ??
    email.split("@")[0];
  let failureAction: "scim.user_created" | "scim.user_adopted" = "scim.user_created";

  try {
    // Check if user already exists globally (e.g. created via OIDC login
    // before SCIM provisioning, OR adopted by SCIM in another org).
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { ...USER_SELECT, authMethod: true },
    });

    if (existing) {
      failureAction = "scim.user_adopted";
      // Only adopt users already created via SSO or previously SCIM-linked.
      // Local-credential accounts require explicit admin action to link.
      if (existing.authMethod !== "OIDC" && !existing.scimExternalId) {
        const err = new Error(
          `User ${email} exists as a local account and cannot be adopted via SCIM. ` +
          "An administrator must link or convert the account first.",
        );
        (err as Error & { scimConflict: boolean }).scimConflict = true;
        throw err;
      }

      // Cross-tenant adoption guard: the existing User has been linked
      // to an OrgMember somewhere — if NONE of those memberships is in
      // THIS organisation, refusing the adoption is the safe default.
      // An auto-upsert would let a SCIM admin in org B attach their
      // org to an account belonging to org A purely on email collision,
      // and SCIM PATCH/PUT can then mutate the shared User row
      // (email, lock state) — creating a cross-tenant control path
      // over identity state. Require an explicit cross-org link flow
      // (or pre-existing membership) instead.
      const memberOfThisOrg = await prisma.orgMember.findUnique({
        where: {
          userId_organizationId: { userId: existing.id, organizationId },
        },
        select: { userId: true },
      });
      if (!memberOfThisOrg) {
        const err = new Error(
          `User ${email} already exists in another organisation and cannot be auto-adopted by SCIM. ` +
          "An administrator must add the user to this organisation through the org-management surface first.",
        );
        (err as Error & { scimConflict: boolean }).scimConflict = true;
        throw err;
      }

      // Adopt: link the SCIM externalId to the existing SSO user. The
      // OrgMember row in this org already exists (we just verified it);
      // no upsert needed.
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: {
          scimExternalId: scimUser.externalId ?? existing.scimExternalId,
        },
        select: USER_SELECT,
      });

      await writeScimAuditLog({
        action: "scim.user_adopted",
        entityType: "ScimUser",
        entityId: updated.id,
        metadata: { email, scimExternalId: scimUser.externalId, organizationId },
        status: "success",
      });

      return { user: toScimUser(updated), adopted: true };
    }

    // Generate random password (SCIM users authenticate via SSO, not local credentials)
    const tempPassword = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        authMethod: "OIDC",
        scimExternalId: scimUser.externalId,
        lockedAt: scimUser.active === false ? new Date() : null,
        lockedBy: scimUser.active === false ? "SCIM" : null,
        orgMemberships: {
          create: { organizationId, role: "MEMBER", provisionedVia: "SCIM" },
        },
      },
      select: USER_SELECT,
    });

    await writeScimAuditLog({
      action: "scim.user_created",
      entityType: "ScimUser",
      entityId: user.id,
      metadata: { email, scimExternalId: scimUser.externalId, organizationId },
      status: "success",
    });

    return { user: toScimUser(user), adopted: false };
  } catch (error) {
    await writeScimAuditLog({
      action: failureAction,
      entityType: "ScimUser",
      entityId: email,
      metadata: { email, scimExternalId: scimUser.externalId, organizationId },
      status: "failure",
      error,
    });
    throw error;
  }
}

/**
 * Verify the SCIM caller's organisation owns this user. Returns the
 * user-membership pair on success and null on miss (the caller should
 * 404 the request — never reveal whether a user with that id exists
 * in some OTHER organisation).
 */
async function requireOrgMember(organizationId: string, userId: string) {
  return prisma.orgMember.findUnique({
    where: {
      userId_organizationId: { userId, organizationId },
    },
    select: { role: true, provisionedVia: true },
  });
}

/**
 * Coexistence guard for SCIM removal / deactivation. SCIM-provisioned and
 * local users coexist: the IdP is authoritative only over identities it
 * provisions. Refuse to `deprovision`/`deactivate` a LOCAL member (signup /
 * invite — the IdP doesn't own it) or the org OWNER (never let the IdP lock
 * out or remove the owner; transfer ownership first). Throws
 * ScimProtectedMemberError, which the SCIM Users route maps to 403 without
 * firing a false sync-failed alert.
 */
function assertScimMayRemoveOrLock(
  membership: { role: string; provisionedVia: string },
  verb: "deprovision" | "deactivate",
) {
  if (membership.provisionedVia === "LOCAL") {
    throw new ScimProtectedMemberError(
      "local_member",
      `Cannot ${verb} a locally-managed member via SCIM. This account was not ` +
        "provisioned by the identity provider; an administrator must manage it directly.",
    );
  }
  if (membership.role === "OWNER") {
    throw new ScimProtectedMemberError(
      "owner",
      `Cannot ${verb} the organization owner via SCIM. Transfer ownership to ` +
        "another member first.",
    );
  }
}
export async function scimUpdateUser(
  organizationId: string,
  id: string,
  scimUser: Partial<ScimUser>,
) {
  debugLog("scim", `PUT /Users/${id}`, { active: scimUser.active, userName: scimUser.userName, externalId: scimUser.externalId });
  const membership = await requireOrgMember(organizationId, id);
  if (!membership) return null;
  const data: Record<string, unknown> = {};

  if (scimUser.name?.formatted) data.name = scimUser.name.formatted;
  const email = scimUser.emails?.[0]?.value ?? scimUser.userName;
  if (email) data.email = email;
  if (scimUser.active !== undefined) {
    if (scimUser.active) {
      // Only clear SCIM-originated locks; preserve admin-initiated locks
      const existing = await prisma.user.findUnique({ where: { id }, select: { lockedBy: true } });
      if (existing?.lockedBy === "SCIM") {
        data.lockedAt = null;
        data.lockedBy = null;
      }
    } else {
      data.lockedAt = new Date();
      // Only claim SCIM ownership if not already locked by another source
      const existing = await prisma.user.findUnique({ where: { id }, select: { lockedBy: true } });
      if (!existing?.lockedBy || existing.lockedBy === "SCIM") {
        data.lockedBy = "SCIM";
      }
    }
  }
  if (scimUser.externalId) data.scimExternalId = scimUser.externalId;
  // Coexistence: SCIM must not LOCK (deactivate) a member it does not own — a
  // LOCAL member (signup/invite) is outside the IdP's purview, and an OWNER
  // must never be locked out by the IdP. Benign profile updates and SCIM
  // non-owner deactivation are unaffected.
  if (data.lockedAt instanceof Date) {
    assertScimMayRemoveOrLock(membership, "deactivate");
  }

  if (Object.keys(data).length === 0) {
    // No fields changed, skip update
    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    return existingUser ? toScimUser(existingUser) : null;
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });

    await writeScimAuditLog({
      action: "scim.user_updated",
      entityType: "ScimUser",
      entityId: id,
      metadata: { fields: Object.keys(data) },
      status: "success",
    });

    return toScimUser(user);
  } catch (error) {
    await writeScimAuditLog({
      action: "scim.user_updated",
      entityType: "ScimUser",
      entityId: id,
      metadata: { fields: Object.keys(data) },
      status: "failure",
      error,
    });
    throw error;
  }
}

export async function scimPatchUser(
  organizationId: string,
  id: string,
  operations: ScimPatchOp[],
) {
  debugLog("scim", `PATCH /Users/${id}`, { operations: operations.map(o => ({ op: o.op, path: o.path, value: o.value })) });
  const membership = await requireOrgMember(organizationId, id);
  if (!membership) return null;
  const data: Record<string, unknown> = {};

  for (const op of operations) {
    // RFC 7644: operation names are case-insensitive (e.g. Azure AD sends "Replace")
    const opName = op.op?.toLowerCase();
    if (opName === "replace" && op.path === "active" && typeof op.value === "boolean") {
      if (op.value) {
        // Only clear SCIM-originated locks; preserve admin-initiated locks
        const existing = await prisma.user.findUnique({ where: { id }, select: { lockedBy: true } });
        if (existing?.lockedBy === "SCIM") {
          data.lockedAt = null;
          data.lockedBy = null;
        }
      } else {
        data.lockedAt = new Date();
        // Only claim SCIM ownership if not already locked by another source
        const existing = await prisma.user.findUnique({ where: { id }, select: { lockedBy: true } });
        if (!existing?.lockedBy || existing.lockedBy === "SCIM") {
          data.lockedBy = "SCIM";
        }
      }
    }
    if (opName === "replace" && op.path === "name.formatted" && typeof op.value === "string") {
      data.name = op.value;
    }
    if (opName === "replace" && op.path === "userName" && typeof op.value === "string") {
      data.email = op.value;
    }
    if (opName === "replace" && op.path === "externalId" && typeof op.value === "string") {
      data.scimExternalId = op.value;
    }
    // Handle bulk replace (no path, value is an object)
    if (opName === "replace" && !op.path && typeof op.value === "object" && op.value !== null) {
      const val = op.value as Record<string, unknown>;
      if (typeof val.active === "boolean") {
        if (val.active) {
          // Only clear SCIM-originated locks; preserve admin-initiated locks
          const existing = await prisma.user.findUnique({ where: { id }, select: { lockedBy: true } });
          if (existing?.lockedBy === "SCIM") {
            data.lockedAt = null;
            data.lockedBy = null;
          }
        } else {
          data.lockedAt = new Date();
          // Only claim SCIM ownership if not already locked by another source
          const existing = await prisma.user.findUnique({ where: { id }, select: { lockedBy: true } });
          if (!existing?.lockedBy || existing.lockedBy === "SCIM") {
            data.lockedBy = "SCIM";
          }
        }
      }
      if (typeof val.userName === "string") data.email = val.userName;
      if (typeof val.externalId === "string") data.scimExternalId = val.externalId;
      if (val.name && typeof val.name === "object") {
        const nameObj = val.name as Record<string, unknown>;
        if (typeof nameObj.formatted === "string") data.name = nameObj.formatted;
      }
    }
  }

  // Coexistence guard — see scimUpdateUser. Refuse to lock a LOCAL member or
  // the OWNER even when the IdP sends active=false.
  if (data.lockedAt instanceof Date) {
    assertScimMayRemoveOrLock(membership, "deactivate");
  }

  if (Object.keys(data).length > 0) {
    try {
      const user = await prisma.user.update({
        where: { id },
        data,
        select: USER_SELECT,
      });

      await writeScimAuditLog({
        action: "scim.user_patched",
        entityType: "ScimUser",
        entityId: id,
        metadata: { fields: Object.keys(data), operations: operations.map((o) => o.op) },
        status: "success",
      });

      return toScimUser(user);
    } catch (error) {
      await writeScimAuditLog({
        action: "scim.user_patched",
        entityType: "ScimUser",
        entityId: id,
        metadata: { fields: Object.keys(data), operations: operations.map((o) => o.op) },
        status: "failure",
        error,
      });
      throw error;
    }
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: USER_SELECT,
  });
  return user ? toScimUser(user) : null;
}

/**
 * Fire a scim_sync_failed event alert for all non-system environments.
 * SCIM is system-wide and has no single environmentId, so we broadcast
 * the failure to every environment that exists.
 */
export async function fireScimSyncFailedAlert(errorMessage: string): Promise<void> {
  const environments = await prisma.environment.findMany({
    where: { isSystem: false },
    select: { id: true },
  });
  for (const env of environments) {
    void fireEventAlert("scim_sync_failed", env.id, {
      message: `SCIM sync failed: ${errorMessage}`,
    });
  }
}

/**
 * SCIM deprovisioning. In multi-tenant deployments this REMOVES the
 * user from the SCIM caller's organisation. If the user still belongs
 * to other orgs the global User row is left untouched (so SSO sign-in
 * into those orgs continues to work). Otherwise the user is locked
 * globally — preserving the OSS single-tenant deactivation behaviour.
 * Returns `null` when the user is not a member of the caller's org.
 */
export async function scimDeleteUser(organizationId: string, id: string) {
  debugLog("scim", `DELETE /Users/${id} org=${organizationId}`);
  // Not a member of THIS org → null (the route 404s; never reveal peer-org
  // existence). Coexistence: SCIM may only deprovision memberships it
  // provisioned — never a LOCAL member or the OWNER (transfer ownership first).
  const membership = await requireOrgMember(organizationId, id);
  if (!membership) return null;
  assertScimMayRemoveOrLock(membership, "deprovision");
  try {
    await withOrgTx(organizationId, async (tx) => {
      // Step 1: clear EVERY team membership for this user on teams owned
      // by the deprovisioning org. `OrgMember.delete` alone is not enough
      // — `withTeamAccess` and the team-based authorisation paths read
      // from `TeamMember`, so leaving stale rows behind keeps the user
      // authorised on this org's teams (especially for active sessions).
      await tx.teamMember.deleteMany({
        where: {
          userId: id,
          team: { organizationId },
        },
      });

      // Step 2: remove the OrgMember for this org.
      await tx.orgMember.delete({
        where: {
          userId_organizationId: { userId: id, organizationId },
        },
      });

      // Step 3: if the user has no remaining org memberships, lock the
      // global User. SCIM ownership of the lock is only claimed when
      // no other source already owns it (admin-locked rows survive).
      const remaining = await tx.orgMember.count({ where: { userId: id } });
      if (remaining === 0) {
        const existing = await tx.user.findUnique({
          where: { id },
          select: { lockedBy: true },
        });
        const lockedBy =
          !existing?.lockedBy || existing.lockedBy === "SCIM"
            ? "SCIM"
            : existing.lockedBy;
        await tx.user.update({
          where: { id },
          data: { lockedAt: new Date(), lockedBy },
        });
      }
    });

    await writeScimAuditLog({
      action: "scim.user_deactivated",
      entityType: "ScimUser",
      entityId: id,
      metadata: { organizationId },
      status: "success",
    });
    return { ok: true as const };
  } catch (error) {
    await writeScimAuditLog({
      action: "scim.user_deactivated",
      entityType: "ScimUser",
      entityId: id,
      metadata: { organizationId },
      status: "failure",
      error,
    });
    throw error;
  }
}
