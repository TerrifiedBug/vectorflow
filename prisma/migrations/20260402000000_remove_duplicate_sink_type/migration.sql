-- Delete any existing DUPLICATE_SINK recommendations before removing the enum value
DELETE FROM "CostRecommendation" WHERE "type" = 'DUPLICATE_SINK';

-- Remove DUPLICATE_SINK from RecommendationType enum
ALTER TYPE "RecommendationType" RENAME TO "RecommendationType_old";
CREATE TYPE "RecommendationType" AS ENUM ('LOW_REDUCTION', 'HIGH_ERROR_RATE', 'STALE_PIPELINE');
ALTER TABLE "CostRecommendation" ALTER COLUMN "type" TYPE "RecommendationType" USING ("type"::text::"RecommendationType");
DROP TYPE "RecommendationType_old";
