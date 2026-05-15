/**
 * Per-organization settings accessor.
 *
 * In OSS / self-hosted mode there is exactly one Organization ("default") and
 * this function always returns its settings, behaving like the old
 * SystemSettings singleton.
 *
 * In Cloud mode the organizationId comes from the request context (session or
 * agent token) and each org has independent settings.
 *
 * On first access for an org that has no settings row yet (e.g. a freshly
 * created org), a row is created with all defaults — identical behaviour to
 * Prisma's upsert-on-read pattern.
 */

import { prisma } from "@/lib/prisma";
import type { OrganizationSettings } from "@/generated/prisma";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";

export type OrgSettings = OrganizationSettings;

/**
 * Return the OrganizationSettings for `organizationId`, creating it with
 * defaults if it doesn't exist yet.
 */
export async function getOrgSettings(
  organizationId: string = DEFAULT_ORG_ID,
): Promise<OrgSettings> {
  const existing = await prisma.organizationSettings.findUnique({
    where: { organizationId },
  });
  if (existing) return existing;

  // Create on first access (handles fresh org signup and OSS first-run)
  return prisma.organizationSettings.create({
    data: { organizationId },
  });
}

/**
 * Upsert settings for an org. Merges `data` over existing values.
 * Caller is responsible for encrypting sensitive fields before calling.
 */
export async function updateOrgSettings(
  organizationId: string,
  data: Partial<Omit<OrgSettings, "id" | "organizationId" | "updatedAt">>,
): Promise<OrgSettings> {
  return prisma.organizationSettings.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
  });
}
