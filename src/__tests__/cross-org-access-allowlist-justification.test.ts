/**
 * Companion to `cross-org-access.test.ts`.
 *
 * The main audit allows a small set of procedures through
 * `INTENTIONALLY_UNGUARDED` because they do tenant scoping inline in
 * the handler rather than via `withTeamAccess` / `requirePlatformOperator`.
 * Each entry carries a comment naming the inline check that justifies
 * the exception.
 *
 * This test asserts the named check IS STILL IN THE FILE. A future
 * refactor that removes the inline check would otherwise leave the
 * procedure silently unguarded — `INTENTIONALLY_UNGUARDED` is an
 * unconditional suppress of the main gate check.
 *
 * Tests here grep source files for the documented patterns. They are
 * intentionally lenient (substring search) so a stylistic refactor
 * does not trip the test, but tight enough that an actual REMOVAL
 * of the named check fails CI.
 *
 * If you need to update an entry: change the pattern below at the
 * same time as the inline check in the handler, and bring a Codex /
 * security reviewer along for the ride.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Justification {
  /** Procedure path the entry guards. */
  procedure: string;
  /** Source file relative to repo root. */
  file: string;
  /**
   * Substrings the source file MUST contain. AND-semantics: every
   * entry in the array must appear at least once in the file.
   */
  mustContain: string[];
}

const JUSTIFICATIONS: Justification[] = [
  // team.teamRole — returns the caller's own membership role. Cross-org
  // probing is safe by construction: the response shape is identical
  // regardless of team existence, so no team-existence side channel.
  {
    procedure: "team.teamRole",
    file: "src/server/routers/team.ts",
    mustContain: ["teamRole", "teamMember.findUnique"],
  },

  // audit.list / audit.deployments / audit.exportDeployments / audit.exportAuditLog enforce
  // tenancy via getAuditScope(userId) + pushAuditScope(conditions) — a
  // custom scoping helper that injects accessible (teamId, environmentId)
  // pairs into the Prisma WHERE.
  {
    procedure: "audit.list / deployments / exportDeployments / exportAuditLog",
    file: "src/server/routers/audit.ts",
    mustContain: ["getAuditScope", "pushAuditScope"],
  },

  // dashboard.pipelineCards / metrics.getComponentMetrics /
  // metrics.getNodePipelineRates — inline authorisation: load the
  // entity, then assert the caller is a super-admin OR a TeamMember
  // of the resolved team.
  {
    procedure: "dashboard.pipelineCards",
    file: "src/server/routers/dashboard.ts",
    mustContain: ["isOrgWideAdmin", "teamMember.findUnique"],
  },
  {
    procedure: "metrics.getComponentMetrics / getNodePipelineRates",
    file: "src/server/routers/metrics.ts",
    mustContain: ["isOrgWideAdmin", "teamMember.findUnique"],
  },

  // pipeline.stopTap — inline auth in the handler. Codex P1 round-8 fix.
  {
    procedure: "pipeline.stopTap",
    file: "src/server/routers/pipeline-observability.ts",
    mustContain: ["stopTap", "isOrgWideAdmin"],
  },

  // template.get / template.delete — system templates with teamId=null
  // are readable by all authenticated users; team-owned templates
  // require membership or super-admin.
  {
    procedure: "template.get / template.delete",
    file: "src/server/routers/template.ts",
    mustContain: ["isOrgWideAdmin", "teamMember.findUnique"],
  },

  // org.verifyDomain / org.unclaimDomain — load the OrganizationDomainClaim
  // by id and reject if `claim.organizationId !== ctx.organizationId`.
  {
    procedure: "org.verifyDomain / org.unclaimDomain",
    file: "src/server/routers/org.ts",
    mustContain: ["organizationDomainClaim", "claim.organizationId !== ctx.organizationId"],
  },

  // orgAccessGrant.approve / orgAccessGrant.revoke — org-scoped break-glass
  // grant consent. Authorised inline: requireOrgRole(..., input.organizationId,
  // ADMIN/OWNER) plus a grant.organizationId !== input.organizationId boundary
  // check, all inside withOrgTx(input.organizationId).
  {
    procedure: "orgAccessGrant.approve / orgAccessGrant.revoke",
    file: "src/server/routers/org-access-grant.ts",
    mustContain: ["requireOrgRole", "grant.organizationId !== input.organizationId"],
  },
];

const REPO_ROOT = resolve(__dirname, "../..");

describe("INTENTIONALLY_UNGUARDED allowlist justification", () => {
  it.each(JUSTIFICATIONS)(
    "$procedure: $file still contains the documented inline auth markers",
    ({ procedure, file, mustContain }) => {
      const absolute = resolve(REPO_ROOT, file);
      let body: string;
      try {
        body = readFileSync(absolute, "utf-8");
      } catch (err) {
        throw new Error(
          `Cannot read ${file} for ${procedure}: ${(err as Error).message}. ` +
            `If the file moved, update the JUSTIFICATIONS list — but only after ` +
            `confirming the inline auth check moved with it.`,
        );
      }
      const missing = mustContain.filter((token) => !body.includes(token));
      if (missing.length > 0) {
        throw new Error(
          `${procedure} (${file}) is missing the inline-auth tokens that ` +
            `INTENTIONALLY_UNGUARDED claims it carries: ${missing.join(", ")}.\n\n` +
            `Either (a) restore the inline check, (b) remove the procedure ` +
            `from INTENTIONALLY_UNGUARDED in cross-org-access.test.ts, or ` +
            `(c) if you intentionally renamed the check, update the JUSTIFICATIONS ` +
            `entry — with a Codex / security review attached.`,
        );
      }
      expect(missing).toEqual([]);
    },
  );
});
