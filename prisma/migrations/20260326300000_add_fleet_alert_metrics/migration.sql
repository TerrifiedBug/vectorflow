-- Add fleet-wide alert metric values to AlertMetric enum
ALTER TYPE "AlertMetric" ADD VALUE 'fleet_error_rate';
ALTER TYPE "AlertMetric" ADD VALUE 'fleet_throughput_drop';
ALTER TYPE "AlertMetric" ADD VALUE 'fleet_event_volume';
ALTER TYPE "AlertMetric" ADD VALUE 'node_load_imbalance';
