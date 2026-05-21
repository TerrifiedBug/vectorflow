-- Enable RLS on the remaining tenant tables that verify-rls.sh flagged
-- when its CI gate landed: MagicLinkToken, OperatorApprovalRequest,
-- OrganizationDomainClaim, PlatformAuditLog, ScimGroup, WebhookConfirmation.
--
-- Each table already carries an `organizationId` column; the application
-- layer was the only barrier. RLS adds the database-level fence that the
-- rest of the strict RLS policies installs so a direct query or backup-restore code path
-- cannot read across tenants.
--
-- Same strict policy shape as the strict RLS policies / 20260516000001: the GUC must
-- match the row, and the sentinel-coerced unset GUC denies access.

DO $$
DECLARE
    tbl text;
    tenant_tables text[] := ARRAY[
        'MagicLinkToken',
        'OperatorApprovalRequest',
        'OrganizationDomainClaim',
        'PlatformAuditLog',
        'ScimGroup',
        'WebhookConfirmation',
        'AuditChainTail'
    ];
BEGIN
    FOREACH tbl IN ARRAY tenant_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON %I;',
            tbl || '_org_isolation', tbl);
        EXECUTE format($p$
            CREATE POLICY %I ON %I
            USING ("organizationId" = current_setting('app.org_id', true))
            WITH CHECK ("organizationId" = current_setting('app.org_id', true));
        $p$, tbl || '_org_isolation', tbl);
    END LOOP;
END $$;
