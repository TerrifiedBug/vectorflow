/**
 * OSS first-run setup. Creates the initial admin user, default Team,
 * default Environment, and binds the user to the default Organization
 * (`DEFAULT_ORG_ID`) as `OWNER` so that `orgProcedure` middleware can
 * resolve their org context.
 *
 * A multi-tenant signup is intentionally not present here: it would mint
 * a fresh `Organization` with a KMS-wrapped DEK and the customer's
 * chosen slug, then create the OWNER and seed Team / Environment under
 * THAT org. Deployments running under strict multi-tenant do NOT call
 * this function.
 */

import { prisma, adminPrisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { ulid } from "ulid";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";
import { isStrictMultiTenantMode } from "@/lib/security-headers";

function buildTelemetryFields(choice: "yes" | "no") {
  if (choice === "yes") {
    return {
      telemetryEnabled: true,
      telemetryInstanceId: ulid(),
      telemetryEnabledAt: new Date(),
    };
  }
  return {
    telemetryEnabled: false,
    telemetryInstanceId: null,
    telemetryEnabledAt: null,
  };
}

export async function isSetupRequired(): Promise<boolean> {
  const userCount = await prisma.user.count();
  return userCount === 0;
}

/**
 * Postgres advisory lock key for the OSS first-run setup. A 63-bit
 * stable hash of the literal string `vectorflow:setup-bootstrap`.
 * Constant rather than computed so we know it never changes across
 * deploys and never collides with other advisory locks the app uses.
 *
 * The number lives in the bigint range (Postgres advisory locks take
 * a signed 8-byte int). Concurrent `completeSetup` callers serialise
 * on this key; whichever loses the race observes `userCount > 0`
 * inside its transaction and aborts. /
 *
 */
// Hex 0:7416d50e8e8a9111 — 16 digits, low-bit clear so it never collides
// with a sign-extended negative on the Postgres signed bigint side. Use
// hex literal (not BigInt literal) so this file targets ES2017 cleanly.
const SETUP_ADVISORY_LOCK_KEY = "8364738473773410001";

/**
 * Sentinel error thrown when a concurrent caller has already completed
 * setup. The route layer translates this to a 400 — the same response
 * the pre-lock TOCTOU guard returned.
 */
export class SetupAlreadyCompletedError extends Error {
  readonly _tag = "SetupAlreadyCompletedError" as const;
  constructor() {
    super("Setup has already been completed.");
    this.name = "SetupAlreadyCompletedError";
  }
}

export async function completeSetup(input: {
  email: string;
  name: string;
  password: string;
  teamName: string;
  telemetryChoice: "yes" | "no";
  requireTwoFactor: boolean;
  environmentName: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  // OSS first-run bootstrap: create the admin user + default-org membership
  // atomically. Runs on the admin (owner) client so the multi-statement
  // transaction stays on one connection (the extended client would split each
  // statement into its own transaction) and the OrgMember insert is not blocked
  // by RLS before any org context exists. Multi-tenant cloud does not call this.
  return adminPrisma.$transaction(async (tx) => {
    // serialise the OSS first-run bootstrap. Without
    // this advisory lock two concurrent POST /api/setup calls both
    // pass `isSetupRequired()` (userCount === 0), then both insert a
    // user; the loser silently overwrites the winner's admin row.
    // pg_advisory_xact_lock blocks the second caller until the first
    // commits, after which the userCount re-check below catches the
    // already-completed state.
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(${SETUP_ADVISORY_LOCK_KEY})`,
    );
    const existingUserCount = await tx.user.count();
    if (existingUserCount > 0) {
      throw new SetupAlreadyCompletedError();
    }

    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        authMethod: "LOCAL",
      },
    });

    // Bind the new user to the default organisation as OWNER so that
    // `orgProcedure` middleware (which requires an OrgMember row) lets
    // them in. The Organization row itself is seeded by the
    // migration `20260515000001_add_organization_tenancy` — no need to
    // upsert it here.
    await tx.orgMember.create({
      data: {
        userId: user.id,
        organizationId: DEFAULT_ORG_ID,
        role: "OWNER",
      },
    });

    // Single-tenant bootstrap: mirror super-admin into the
    // `PlatformOperator` table so the admin / settings gate
    // (`requirePlatformOperator`) resolves a row. Multi-tenant deployments
    // do not call `completeSetup`; the conditional gates defensively in
    // case that ever changes. Role INCIDENT is highest rank; single-tenant
    // deployments typically have one operator so granularity is moot —
    // INCIDENT just future-proofs against gates being raised later.
    if (!isStrictMultiTenantMode()) {
      await tx.platformOperator.create({
        data: {
          email: input.email,
          name: input.name,
          role: "INCIDENT",
        },
      });
    }

    const team = await tx.team.create({
      data: {
        name: input.teamName,
        requireTwoFactor: input.requireTwoFactor,
        organizationId: DEFAULT_ORG_ID,
      },
    });

    await tx.teamMember.create({
      data: {
        userId: user.id,
        teamId: team.id,
        role: "ADMIN",
      },
    });

    const environment = await tx.environment.create({
      data: {
        name: input.environmentName,
        teamId: team.id,
        organizationId: DEFAULT_ORG_ID,
      },
    });

    await tx.team.update({
      where: { id: team.id },
      data: { defaultEnvironmentId: environment.id },
    });

    const telemetryFields = buildTelemetryFields(input.telemetryChoice);

    await tx.systemSettings.upsert({
      where: { id: "singleton" },
      update: telemetryFields,
      create: { id: "singleton", ...telemetryFields },
    });

    return { user, team, environment };
  });
}
