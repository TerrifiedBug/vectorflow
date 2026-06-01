import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Prisma, PrismaClient, Team } from "@/generated/prisma";

/**
 * Real-database proof that the RLS extension + org context actually fence
 * cross-tenant access. This is the integration counterpart to the unit
 * tests: it talks to a live Postgres where the app connects as the fenced
 * NOBYPASSRLS role and the strict RLS policies are installed.
 *
 * It is SKIPPED unless both URLs are provided, so `pnpm test` in CI without
 * a database is a no-op. To run it:
 *
 *   1. Migrate a DB and provision the fenced role (scripts/grant-vectorflow-app.sql).
 *   2. RLS_IT_APP_URL=postgresql://vectorflow_app:<pw>@host/db \
 *      RLS_IT_ADMIN_URL=postgresql://<owner>@host/db \
 *      npx vitest run src/lib/__tests__/rls-isolation.integration.test.ts
 */

const APP_URL = process.env.RLS_IT_APP_URL;
const ADMIN_URL = process.env.RLS_IT_ADMIN_URL;
const ENABLED = Boolean(APP_URL && ADMIN_URL);

const ORG_A = "it-org-a";
const ORG_B = "it-org-b";

/** Structural view of the org-scoped client — the few ops the test drives. */
interface ScopedClient {
  team: {
    findMany(args?: Prisma.TeamFindManyArgs): Promise<Team[]>;
    create(args: Prisma.TeamCreateArgs): Promise<Team>;
    count(args?: Prisma.TeamCountArgs): Promise<number>;
  };
  organization: {
    findMany(args?: Prisma.OrganizationFindManyArgs): Promise<Array<{ id: string }>>;
    findUnique(args: Prisma.OrganizationFindUniqueArgs): Promise<{ id: string } | null>;
  };
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

(ENABLED ? describe : describe.skip)("RLS isolation (integration)", () => {
  let prisma: ScopedClient;
  let adminPrisma: PrismaClient;
  let runWithOrgContext: <T>(orgId: string, fn: () => Promise<T>) => Promise<T>;
  let withOrgTx: <T>(orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

  beforeAll(async () => {
    // The clients read DATABASE_URL / DATABASE_ADMIN_URL at module-eval time,
    // and vitest's config `env` pins DATABASE_URL to a placeholder, so a
    // hoisted static import would bind the wrong URL. Setting env then
    // dynamic-importing is the sanctioned "module loading boundary" exception
    // to the static-import rule.
    process.env.DATABASE_URL = APP_URL;
    process.env.DATABASE_ADMIN_URL = ADMIN_URL;
    const prismaMod = await import("@/lib/prisma");
    const orgCtxMod = await import("@/lib/org-context");
    const withOrgTxMod = await import("@/lib/with-org-tx");
    // The extended client's delegate generics differ from PrismaClient's
    // (Exact vs SelectSubset) by design; narrow to the structural view rather
    // than couple the test to the extension's inferred type.
    prisma = prismaMod.prisma as unknown as ScopedClient;
    adminPrisma = prismaMod.adminPrisma;
    runWithOrgContext = orgCtxMod.runWithOrgContext;
    withOrgTx = withOrgTxMod.withOrgTx;

    for (const [id, slug, name] of [
      [ORG_A, "itorga", "IT Org A"],
      [ORG_B, "itorgb", "IT Org B"],
    ] as const) {
      await adminPrisma.organization.upsert({
        where: { id },
        create: { id, slug, name },
        update: { slug, name },
      });
    }
    await adminPrisma.team.deleteMany({ where: { organizationId: { in: [ORG_A, ORG_B] } } });
    await adminPrisma.team.createMany({
      data: [
        { id: "it-team-a1", name: "A1", organizationId: ORG_A },
        { id: "it-team-a2", name: "A2", organizationId: ORG_A },
        { id: "it-team-b1", name: "B1", organizationId: ORG_B },
      ],
    });
  });

  afterAll(async () => {
    if (!adminPrisma) return;
    await adminPrisma.team.deleteMany({ where: { organizationId: { in: [ORG_A, ORG_B] } } });
    await adminPrisma.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
  });

  it("scopes reads to the active org context", async () => {
    const a = await runWithOrgContext(ORG_A, () => prisma.team.findMany());
    expect(a.map((t) => t.id).sort()).toEqual(["it-team-a1", "it-team-a2"]);

    const b = await runWithOrgContext(ORG_B, () => prisma.team.findMany());
    expect(b.map((t) => t.id).sort()).toEqual(["it-team-b1"]);
  });

  it("returns zero rows with NO org context (fenced role denies by default)", async () => {
    const none = await prisma.team.findMany({ where: { organizationId: { in: [ORG_A, ORG_B] } } });
    expect(none).toEqual([]);
  });

  it("blocks a cross-org write via the policy WITH CHECK", async () => {
    await expect(
      runWithOrgContext(ORG_A, () =>
        prisma.team.create({ data: { id: "it-evil", name: "evil", organizationId: ORG_B } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("counts only the active org's rows", async () => {
    const cnt = await runWithOrgContext(ORG_A, () =>
      prisma.team.count({ where: { organizationId: { in: [ORG_A, ORG_B] } } }),
    );
    expect(cnt).toBe(2);
  });

  it("scopes multi-statement withOrgTx work", async () => {
    const result = await withOrgTx(ORG_B, async (tx) => {
      const teams = await tx.team.findMany();
      const count = await tx.team.count();
      return { ids: teams.map((t) => t.id), count };
    });
    expect(result).toEqual({ ids: ["it-team-b1"], count: 1 });
  });

  it("lets the admin client read across orgs (the escape hatch)", async () => {
    const all = await adminPrisma.team.findMany({
      where: { organizationId: { in: [ORG_A, ORG_B] } },
    });
    expect(all.length).toBe(3);
  });

  it("fences the Organization table itself (own row only, none unscoped)", async () => {
    // Scoped to org A: sees only org A's Organization row, not org B's.
    const scoped = await runWithOrgContext(ORG_A, () =>
      prisma.organization.findMany({ where: { id: { in: [ORG_A, ORG_B] } } }),
    );
    expect(scoped.map((o) => o.id)).toEqual([ORG_A]);

    // In-context read of its OWN row by id resolves (the policy admits it).
    const own = await runWithOrgContext(ORG_A, () =>
      prisma.organization.findUnique({ where: { id: ORG_A } }),
    );
    expect(own?.id).toBe(ORG_A);

    // No scope: the fenced role enumerates zero orgs.
    const unscoped = await prisma.organization.findMany({
      where: { id: { in: [ORG_A, ORG_B] } },
    });
    expect(unscoped).toEqual([]);
  });

  it("scopes RAW $queryRaw against fenced tables (the metrics-query/fleet-data case)", async () => {
    // Raw SQL that reads a fenced table directly — mirrors metrics-query.ts
    // joining "Pipeline" and fleet-data.ts reading "VectorNode". Under the
    // fenced role this returns rows only when the extension set app.org_id.
    const a = await runWithOrgContext(ORG_A, () =>
      prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Team" WHERE id IN ('it-team-a1', 'it-team-a2', 'it-team-b1') ORDER BY id
      `,
    );
    expect(a.map((r) => r.id)).toEqual(["it-team-a1", "it-team-a2"]);

    const b = await runWithOrgContext(ORG_B, () =>
      prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Team" WHERE id IN ('it-team-a1', 'it-team-a2', 'it-team-b1')
      `,
    );
    expect(b.map((r) => r.id)).toEqual(["it-team-b1"]);

    // $queryRawUnsafe (positional args) is the exact API metrics-query.ts uses.
    const aUnsafe = await runWithOrgContext(ORG_A, () =>
      prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Team" WHERE id = ANY($1::text[]) ORDER BY id`,
        ["it-team-a1", "it-team-a2", "it-team-b1"],
      ),
    );
    expect(aUnsafe.map((r) => r.id)).toEqual(["it-team-a1", "it-team-a2"]);
  });

  it("returns zero rows for a RAW read of a fenced table with NO context", async () => {
    const none = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Team" WHERE id IN ('it-team-a1', 'it-team-a2', 'it-team-b1')
    `;
    expect(none).toEqual([]);
  });
});
