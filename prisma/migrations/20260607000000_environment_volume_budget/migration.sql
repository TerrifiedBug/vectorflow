-- NF-3: per-environment monthly VOLUME budget (GB).
--
-- Complements the existing $-cost budget (Environment.costBudgetCents). The
-- cost-budget alert is skipped when no per-GB rate is set (costPerGbCents = 0);
-- the volume budget fires a budget alert on raw-volume breach regardless, for
-- teams that cap on GB rather than $.
--
-- Additive, nullable column on an already-RLS-protected table — no policy or
-- backfill needed.
ALTER TABLE "Environment" ADD COLUMN "volumeBudgetGb" INTEGER;
