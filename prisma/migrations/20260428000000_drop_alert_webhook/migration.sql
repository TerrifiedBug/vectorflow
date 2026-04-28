-- Drop the legacy AlertWebhook model in favor of NotificationChannel(type=webhook).
--
-- The NotificationChannel infrastructure (drivers, DeliveryAttempt tracking,
-- AlertRuleChannel routing) fully subsumes AlertWebhook's functionality and
-- adds delivery tracking, retries, and per-rule routing that AlertWebhook
-- never had.
--
-- Existing AlertWebhook rows MUST be migrated to NotificationChannel(type=webhook)
-- before this migration is applied (operator action — no automated copy because
-- hmacSecret is plaintext and config encryption strategy is decided per-deploy).

-- Drop the AlertWebhook table (CASCADE drops the FK from Environment too).
DROP TABLE IF EXISTS "AlertWebhook" CASCADE;

-- Drop the dangling webhookId column on DeliveryAttempt (only legacy_webhook
-- rows used it; all DeliveryAttempts now route via channelId).
ALTER TABLE "DeliveryAttempt" DROP COLUMN IF EXISTS "webhookId";
