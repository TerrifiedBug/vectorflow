-- OSS upgrade gap (S16b OSS-1 follow-up): backfill PlatformOperator from
-- existing super-admin Users.
--
-- Context: PR #354 flipped 35 procedures from `requireSuperAdmin()` (gates on
-- `User.isSuperAdmin = true`) to `requirePlatformOperator()` (gates on a row
-- in `PlatformOperator` matched by email). The flip was correct for Cloud
-- (operators ≠ users) but the OSS bootstrap was never updated to populate
-- `PlatformOperator`. Existing OSS deployments that pull the new image lose
-- their entire admin / settings / SCIM / OIDC / backups surface until a
-- PlatformOperator row exists for the signed-in operator's email.
--
-- This migration is the one-time cure. It creates a PlatformOperator row for
-- every `User WHERE isSuperAdmin = true` not already present (matched on the
-- unique `email` column). Role is INCIDENT — highest rank, passes every gate
-- in `requirePlatformOperator(minRole)` today and any plausible future raise.
-- OSS is single-stamp single-operator; the granularity of SUPPORT / BILLING /
-- INFRA / INCIDENT is not meaningful in that context.
--
-- ─── Idempotency ──────────────────────────────────────────────────────────
-- `ON CONFLICT (email) DO NOTHING` makes re-runs harmless. We do NOT touch
-- existing PlatformOperator rows (no UPDATE) so an operator that's been
-- soft-deleted via `deletedAt` stays decommissioned — manual decommission
-- intent wins over the backfill.
--
-- ─── Cloud safety ─────────────────────────────────────────────────────────
-- Cloud installs do NOT set `User.isSuperAdmin = true` (operators live in a
-- separate population by design). The `WHERE isSuperAdmin = true` filter
-- matches zero rows there, so the INSERT is a no-op on Cloud. No `VF_CLOUD_BUILD`
-- gating needed at the SQL layer.
--
-- ─── Id generation ────────────────────────────────────────────────────────
-- `PlatformOperator.id` is declared `@default(cuid())` in Prisma but Postgres
-- can't generate cuids server-side. We synthesise a unique string with the
-- `op_` prefix + a 24-char hash so the value sorts/looks distinct from cuids
-- generated at the application layer. Future inserts via Prisma still get
-- real cuids; only this backfill row uses the synthesised id.
--
-- ─── Rollback ─────────────────────────────────────────────────────────────
-- DELETE FROM "PlatformOperator" WHERE id LIKE 'op_backfill_%';

INSERT INTO "PlatformOperator" (id, email, name, role, "createdAt", "updatedAt")
SELECT
    'op_backfill_' || substr(md5(random()::text || u."id"), 1, 12),
    u."email",
    u."name",
    'INCIDENT',
    NOW(),
    NOW()
FROM "User" u
WHERE u."isSuperAdmin" = true
ON CONFLICT ("email") DO NOTHING;
