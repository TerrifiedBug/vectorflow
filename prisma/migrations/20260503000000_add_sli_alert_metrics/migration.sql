-- AlterEnum: add pipeline-scoped SLI metrics so AlertRules can fire on
-- latency and throughput floor breaches alongside the existing per-node
-- and fleet-wide metrics.
ALTER TYPE "AlertMetric" ADD VALUE 'latency_mean';
ALTER TYPE "AlertMetric" ADD VALUE 'throughput_floor';
