/**
 * OSS first-run setup. Creates the initial admin user, default Team,
 * default Environment, and binds the user to the default Organization
 * (`DEFAULT_ORG_ID`) as `OWNER` so that `orgProcedure` middleware can
 * resolve their org context.
 *
 * Cloud signup follows a different flow in the closed `cloud/`
 * workspace: it mints a fresh `Organization` with a KMS-wrapped DEK and
 * the customer's chosen slug, then creates the OWNER and seeds Team /
 * Environment under THAT org. The Cloud path does NOT call this
 * function.
 */

import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { ulid } from "ulid";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";
import { isCloudBuildProfile } from "@/lib/security-headers";

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

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        authMethod: "LOCAL",
        isSuperAdmin: true,
      },
    });

    // Bind the new user to the default organisation as OWNER so that
    // `orgProcedure` middleware (which requires an OrgMember row) lets
    // them in. The Organization row itself is seeded by the Phase 1
    // migration `20260515000001_add_organization_tenancy` — no need to
    // upsert it here.
    await tx.orgMember.create({
      data: {
        userId: user.id,
        organizationId: DEFAULT_ORG_ID,
        role: "OWNER",
      },
    });

    // OSS only: mirror super-admin into the PlatformOperator table so the
    // post-PR-#354 admin/settings gate (`requirePlatformOperator`) actually
    // resolves a row. Cloud bootstrap doesn't call completeSetup, but gate
    // defensively in case that ever changes. Role INCIDENT is highest rank;
    // OSS is single-operator so granularity is moot — INCIDENT just future-
    // proofs against gates being raised later (backup restore → INFRA+, etc.).
    if (!isCloudBuildProfile()) {
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
