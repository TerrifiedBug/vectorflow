-- OrganizationDomainClaim — DNS-TXT verified domain ownership.
--
-- Lets an organisation prove control of a DNS domain via a TXT record
-- at `_vectorflow.<domain>`. Downstream policies (OIDC routing,
-- invite-less joining, magic-link domain allow-listing) consult
-- verified claims to make authorization decisions.
--
-- Schema notes:
--   - `(organizationId, domain)` is unique so an org cannot create
--     duplicate claims for the same domain.
--   - The "no two orgs hold a verified claim on the same domain"
--     invariant is enforced at the service layer (not via partial
--     unique index here) because the constraint is conditional on
--     `verifiedAt IS NOT NULL`.
--   - `verificationToken` carries a global UNIQUE so its appearance
--     in any DNS record uniquely identifies one claim.
--
-- Rollback:
--   DROP TABLE "OrganizationDomainClaim";

CREATE TABLE "OrganizationDomainClaim" (
  "id"                TEXT         PRIMARY KEY,
  "organizationId"    TEXT         NOT NULL,
  "domain"            TEXT         NOT NULL,
  "verificationToken" TEXT         NOT NULL,
  "verifiedAt"        TIMESTAMP(3),
  "lastCheckedAt"     TIMESTAMP(3),
  "lastCheckError"    TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationDomainClaim_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrganizationDomainClaim_organizationId_domain_key"
  ON "OrganizationDomainClaim" ("organizationId", "domain");

CREATE UNIQUE INDEX "OrganizationDomainClaim_verificationToken_key"
  ON "OrganizationDomainClaim" ("verificationToken");

CREATE INDEX "OrganizationDomainClaim_domain_idx"
  ON "OrganizationDomainClaim" ("domain");

CREATE INDEX "OrganizationDomainClaim_organizationId_idx"
  ON "OrganizationDomainClaim" ("organizationId");

-- Atomic enforcement of "no two organisations hold a verified claim
-- on the same domain". A partial unique index on (domain) restricted
-- to verifiedAt IS NOT NULL lets multiple orgs hold pending (un-verified)
-- claims on the same name simultaneously, but the moment one of them
-- becomes verified, every concurrent verify attempt for another org
-- fails the UNIQUE constraint at commit time — no TOCTOU window between
-- the service-layer findFirst and the update.
--
-- Prisma's schema language does not express partial unique indexes in
-- this version, so the constraint lives here in raw SQL. The router's
-- `verifyDomain` handler catches Prisma's P2002 unique-violation and
-- maps it to TRPC CONFLICT.
CREATE UNIQUE INDEX "OrganizationDomainClaim_domain_verified_unique"
  ON "OrganizationDomainClaim" ("domain")
  WHERE "verifiedAt" IS NOT NULL;

COMMENT ON TABLE "OrganizationDomainClaim" IS
  'DNS-TXT verified domain ownership claimed by an Organization.';
