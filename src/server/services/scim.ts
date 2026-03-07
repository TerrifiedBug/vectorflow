import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
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

export async function scimListUsers(
  filter?: string,
  startIndex = 1,
  count = 100,
) {
  // Parse simple SCIM filter like 'userName eq "john@example.com"'
  const where: Record<string, unknown> = {};
  if (filter) {
    const userNameMatch = filter.match(/userName\s+eq\s+"(.+?)"/);
    if (userNameMatch) where.email = userNameMatch[1];
    const extIdMatch = filter.match(/externalId\s+eq\s+"(.+?)"/);
    if (extIdMatch) where.scimExternalId = extIdMatch[1];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: startIndex - 1,
      take: count,
      select: USER_SELECT,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: total,
    startIndex,
    itemsPerPage: count,
    Resources: users.map(toScimUser),
  };
}

export async function scimGetUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: USER_SELECT,
  });
  if (!user) return null;
  return toScimUser(user);
}

export async function scimCreateUser(scimUser: ScimUser) {
  const email =
    scimUser.emails?.[0]?.value ?? scimUser.userName;
  const name =
    scimUser.name?.formatted ??
    scimUser.name?.givenName ??
    email.split("@")[0];

  // Generate random password (SCIM users authenticate via SSO, not local credentials)
  const tempPassword = crypto.randomBytes(32).toString("hex");
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      scimExternalId: scimUser.externalId,
      lockedAt: scimUser.active === false ? new Date() : null,
      lockedBy: scimUser.active === false ? "SCIM" : null,
    },
    select: USER_SELECT,
  });

  await writeAuditLog({
    userId: null,
    action: "scim.user_created",
    entityType: "User",
    entityId: user.id,
    metadata: { email, scimExternalId: scimUser.externalId },
  });

  return toScimUser(user);
}

export async function scimUpdateUser(id: string, scimUser: Partial<ScimUser>) {
  const data: Record<string, unknown> = {};

  if (scimUser.name?.formatted) data.name = scimUser.name.formatted;
  if (scimUser.emails?.[0]?.value) data.email = scimUser.emails[0].value;
  if (scimUser.active !== undefined) {
    if (scimUser.active) {
      // Only clear SCIM-originated locks; preserve admin-initiated locks
      const existing = await prisma.user.findUnique({ where: { id }, select: { lockedBy: true } });
      if (!existing?.lockedBy || existing.lockedBy === "SCIM") {
        data.lockedAt = null;
        data.lockedBy = null;
      }
    } else {
      data.lockedAt = new Date();
      data.lockedBy = "SCIM";
    }
  }
  if (scimUser.externalId) data.scimExternalId = scimUser.externalId;

  const user = await prisma.user.update({
    where: { id },
    data,
    select: USER_SELECT,
  });

  await writeAuditLog({
    userId: null,
    action: "scim.user_updated",
    entityType: "User",
    entityId: id,
    metadata: { fields: Object.keys(data) },
  });

  return toScimUser(user);
}

export async function scimPatchUser(
  id: string,
  operations: ScimPatchOp[],
) {
  const data: Record<string, unknown> = {};

  for (const op of operations) {
    // RFC 7644: operation names are case-insensitive (e.g. Azure AD sends "Replace")
    const opName = op.op?.toLowerCase();
    if (opName === "replace" && op.path === "active" && typeof op.value === "boolean") {
      if (op.value) {
        // Only clear SCIM-originated locks; preserve admin-initiated locks
        const existing = await prisma.user.findUnique({ where: { id }, select: { lockedBy: true } });
        if (!existing?.lockedBy || existing.lockedBy === "SCIM") {
          data.lockedAt = null;
          data.lockedBy = null;
        }
      } else {
        data.lockedAt = new Date();
        data.lockedBy = "SCIM";
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
          if (!existing?.lockedBy || existing.lockedBy === "SCIM") {
            data.lockedAt = null;
            data.lockedBy = null;
          }
        } else {
          data.lockedAt = new Date();
          data.lockedBy = "SCIM";
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

  if (Object.keys(data).length > 0) {
    const user = await prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });

    await writeAuditLog({
      userId: null,
      action: "scim.user_patched",
      entityType: "User",
      entityId: id,
      metadata: { fields: Object.keys(data), operations: operations.map((o) => o.op) },
    });

    return toScimUser(user);
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: USER_SELECT,
  });
  return user ? toScimUser(user) : null;
}

export async function scimDeleteUser(id: string) {
  // Don't actually delete -- lock the account
  await prisma.user.update({
    where: { id },
    data: { lockedAt: new Date(), lockedBy: "SCIM" },
  });

  await writeAuditLog({
    userId: null,
    action: "scim.user_deactivated",
    entityType: "User",
    entityId: id,
  });
}
