-- Add globalConfig column for non-graph Vector config sections
-- (enrichment_tables, api, etc.) that need to survive import/export round-trips
ALTER TABLE "Pipeline" ADD COLUMN "globalConfig" JSONB;
