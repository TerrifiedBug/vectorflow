/**
 * Well-known ID and slug for the single default organization used in OSS /
 * self-hosted deployments. Every tenant row backfills to this ID.
 *
 * Multi-tenant deployments create real Organization rows with real IDs on
 * signup — this constant is only used as the single-tenant sentinel and as
 * the migration default.
 */
export const DEFAULT_ORG_ID = "default" as const;
export const DEFAULT_ORG_SLUG = "default" as const;
