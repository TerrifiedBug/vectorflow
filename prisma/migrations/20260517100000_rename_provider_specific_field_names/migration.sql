-- Rename provider-specific field names to provider-opaque ones so the
-- schema does not encode a specific cloud vendor or deployment model.
-- All renames are pure ALTER TABLE … RENAME COLUMN (data preserved); no
-- existing rows change. Dependent views are auto-updated by Postgres;
-- the trigger function bodies that reference the renamed columns by
-- string are recreated below.
--
-- Mapping:
--   Organization.kmsKeyArn       -> dekWrapKeyId       (provider-opaque wrap key id)
--   Organization.byokKeyArn      -> byokWrapKeyId      (provider-opaque customer-supplied wrap key id)
--   Organization.region          -> deploymentLabel    (free-form label, deployment-scoped)
--   OrgAccessGrant.kmsGrantToken -> externalGrantRef   (provider-opaque grant reference)
--   PlatformAuditLog.stampId     -> deploymentId       (deployment-scoped identifier)
--   PlatformAuditChainTail.stampId -> deploymentId
--
-- Rollback (manual; reverse the renames in opposite order so the trigger
-- function and views resolve correctly):
--   ALTER TABLE "PlatformAuditChainTail" RENAME COLUMN "deploymentId" TO "stampId";
--   ALTER TABLE "PlatformAuditLog"       RENAME COLUMN "deploymentId" TO "stampId";
--   ALTER TABLE "OrgAccessGrant"         RENAME COLUMN "externalGrantRef" TO "kmsGrantToken";
--   ALTER TABLE "Organization"           RENAME COLUMN "deploymentLabel" TO "region";
--   ALTER TABLE "Organization"           RENAME COLUMN "byokWrapKeyId"   TO "byokKeyArn";
--   ALTER TABLE "Organization"           RENAME COLUMN "dekWrapKeyId"    TO "kmsKeyArn";
--   ALTER INDEX "PlatformAuditLog_deploymentId_createdAt_idx"
--     RENAME TO "PlatformAuditLog_stampId_createdAt_idx";

-- ─── Organization ─────────────────────────────────────────────────────────
ALTER TABLE "Organization" RENAME COLUMN "kmsKeyArn"  TO "dekWrapKeyId";
ALTER TABLE "Organization" RENAME COLUMN "byokKeyArn" TO "byokWrapKeyId";
ALTER TABLE "Organization" RENAME COLUMN "region"     TO "deploymentLabel";

-- ─── OrgAccessGrant ───────────────────────────────────────────────────────
ALTER TABLE "OrgAccessGrant" RENAME COLUMN "kmsGrantToken" TO "externalGrantRef";

-- ─── PlatformAuditLog / PlatformAuditChainTail ────────────────────────────
ALTER TABLE "PlatformAuditLog"       RENAME COLUMN "stampId" TO "deploymentId";
ALTER TABLE "PlatformAuditChainTail" RENAME COLUMN "stampId" TO "deploymentId";

ALTER INDEX "PlatformAuditLog_stampId_createdAt_idx"
  RENAME TO "PlatformAuditLog_deploymentId_createdAt_idx";

-- ─── Trigger function refresh ─────────────────────────────────────────────
-- The `PlatformAuditLog_guard_update` function body references columns by
-- string. RENAME COLUMN does not rewrite plpgsql function bodies, so the
-- trigger would error on the next UPDATE. Recreate it with the new column
-- name.
CREATE OR REPLACE FUNCTION "PlatformAuditLog_guard_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Allow updates that exclusively touch archivedAt / archivedObjectKey.
  -- Any attempt to modify chain-critical columns raises an exception so
  -- the append-only invariant is preserved at the row level.
  IF (NEW.id              IS DISTINCT FROM OLD.id              OR
      NEW."deploymentId"  IS DISTINCT FROM OLD."deploymentId"  OR
      NEW."operatorId"    IS DISTINCT FROM OLD."operatorId"    OR
      NEW."operatorRole"  IS DISTINCT FROM OLD."operatorRole"  OR
      NEW.action          IS DISTINCT FROM OLD.action          OR
      NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR
      NEW.reason          IS DISTINCT FROM OLD.reason          OR
      NEW."entityType"    IS DISTINCT FROM OLD."entityType"    OR
      NEW."entityId"      IS DISTINCT FROM OLD."entityId"      OR
      NEW.metadata        IS DISTINCT FROM OLD.metadata        OR
      NEW."ipAddress"     IS DISTINCT FROM OLD."ipAddress"     OR
      NEW."createdAt"     IS DISTINCT FROM OLD."createdAt"     OR
      NEW."prevHash"      IS DISTINCT FROM OLD."prevHash"      OR
      NEW.hash            IS DISTINCT FROM OLD.hash)
  THEN
    RAISE EXCEPTION 'PlatformAuditLog: modification of chain-critical fields is prohibited (append-only enforcement)';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── COMMENT refresh ─────────────────────────────────────────────────────
COMMENT ON TABLE "PlatformAuditChainTail" IS
  'Per-deployment tail pointer for PlatformAuditLog hash chain.';
