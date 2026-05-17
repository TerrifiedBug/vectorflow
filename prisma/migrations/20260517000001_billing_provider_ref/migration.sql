-- BillingProviderRef: generic mapping from Organization → external billing
-- provider (customer + optional metered-subscription-item).
--
-- Per §15a R1 / R3: the *table* is generic and lives in OSS; the
-- *provider-specific code* (Stripe webhook handler, Stripe metering
-- aggregator) lives in vectorflow-cloud. Self-hosted OSS installs leave
-- this table empty.

CREATE TABLE "BillingProviderRef" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerCustomerId" TEXT NOT NULL,
    "providerSubscriptionItemId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingProviderRef_pkey" PRIMARY KEY ("id")
);

-- Per-org-per-provider: one mapping row only; resubscribing upserts.
CREATE UNIQUE INDEX "BillingProviderRef_provider_organizationId_key"
  ON "BillingProviderRef"("provider", "organizationId");

-- Inbound-webhook path: provider event carries customerId → resolve org.
CREATE UNIQUE INDEX "BillingProviderRef_provider_providerCustomerId_key"
  ON "BillingProviderRef"("provider", "providerCustomerId");

-- Outbound-metering path: aggregator iterates orgs filtered by org id.
CREATE INDEX "BillingProviderRef_organizationId_idx"
  ON "BillingProviderRef"("organizationId");

-- FK to Organization with cascade — when an org is hard-deleted, the
-- provider mapping evaporates with it. Provider-side cleanup (cancel
-- Stripe subscription, etc.) is the Cloud-side hard-delete runbook's
-- responsibility; this table just stops carrying the stale pointer.
ALTER TABLE "BillingProviderRef" ADD CONSTRAINT "BillingProviderRef_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: same per-org pattern as every other tenant table. The Cloud-side
-- aggregator reads cross-tenant within a service-role context that
-- bypasses app.org_id (see operator-readonly role docs); customer-facing
-- procedures NEVER touch this table.
ALTER TABLE "BillingProviderRef" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingProviderRef" FORCE ROW LEVEL SECURITY;

CREATE POLICY "BillingProviderRef_isolation" ON "BillingProviderRef"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    -- Allow operator-readonly + service-role to bypass the org filter.
    current_setting('app.bypass_rls', true) = 'on'
    OR
    -- Normal per-org access: row's org matches the session's org.
    "organizationId" = current_setting('app.org_id', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
  );
