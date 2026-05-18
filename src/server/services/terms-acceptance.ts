/**
 * Click-through terms acceptance helpers.
 *
 * Multi-tenant signup flows record `(acceptedTermsAt, acceptedTermsVersion)`
 * on the `Organization` row when the OWNER explicitly accepts the
 * operator-published terms. Forced re-acceptance on terms revision is
 * implemented by comparing `acceptedTermsVersion` against the
 * operator's current published version and showing a re-accept gate
 * when they differ.
 *
 * Single-tenant deployments that bypass click-through leave both
 * columns NULL; `requireTermsAcceptance` short-circuits to "accepted"
 * for those.
 */

import { prisma } from "@/lib/prisma";

export interface TermsAcceptanceStatus {
  accepted: boolean;
  acceptedVersion: string | null;
  acceptedAt: Date | null;
  /**
   * The current published terms version the deployment is enforcing.
   * Empty string when the operator has not published a version (the
   * default deployment treats every signup as bypassed).
   */
  currentVersion: string;
}

/**
 * Read the current published terms version from
 * `VF_TERMS_CURRENT_VERSION`. Empty string when unset; callers treat
 * empty-string as "no enforcement".
 */
export function getCurrentTermsVersion(): string {
  return process.env.VF_TERMS_CURRENT_VERSION ?? "";
}

/**
 * Resolve whether the org's recorded acceptance still matches the
 * operator's current published version.
 *
 * - When `VF_TERMS_CURRENT_VERSION` is unset → `accepted: true`
 *   regardless of org state. Single-tenant default.
 * - When the org row has `acceptedTermsVersion === currentVersion`
 *   → `accepted: true`.
 * - Anything else (NULL version, stale version) → `accepted: false`.
 */
export async function getOrgTermsAcceptanceStatus(
  organizationId: string,
): Promise<TermsAcceptanceStatus> {
  const currentVersion = getCurrentTermsVersion();
  if (!currentVersion) {
    return {
      accepted: true,
      acceptedVersion: null,
      acceptedAt: null,
      currentVersion: "",
    };
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { acceptedTermsVersion: true, acceptedTermsAt: true },
  });

  const acceptedVersion = org?.acceptedTermsVersion ?? null;
  const acceptedAt = org?.acceptedTermsAt ?? null;
  return {
    accepted: acceptedVersion === currentVersion,
    acceptedVersion,
    acceptedAt,
    currentVersion,
  };
}

/**
 * Record an OWNER's click-through acceptance. Writes
 * `(acceptedTermsAt = now, acceptedTermsVersion = version)` on the
 * org row. Throws if `version` is empty — the caller MUST resolve the
 * current published version before recording.
 */
export async function recordOrgTermsAcceptance(args: {
  organizationId: string;
  version: string;
}): Promise<void> {
  if (!args.version) {
    throw new Error("recordOrgTermsAcceptance: version MUST be non-empty");
  }
  await prisma.organization.update({
    where: { id: args.organizationId },
    data: {
      acceptedTermsAt: new Date(),
      acceptedTermsVersion: args.version,
    },
  });
}
