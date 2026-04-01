/**
 * Alert router — thin re-export that merges all alert sub-routers.
 *
 * The tRPC client API is unchanged: all procedures remain at `trpc.alert.<procedureName>`.
 * Implementation lives in the focused sub-router files:
 *   - alert-rules.ts      — rule CRUD + snooze/unsnooze
 *   - alert-channels.ts   — notification channel CRUD + test
 *   - alert-webhooks.ts   — webhook CRUD + test
 *   - alert-deliveries.ts — delivery listing + retry
 *   - alert-events.ts     — event listing + acknowledge + correlation
 */

import { router } from "@/trpc/init";
import { alertRulesRouter } from "./alert-rules";
import { alertChannelsRouter } from "./alert-channels";
import { alertWebhooksRouter } from "./alert-webhooks";
import { alertDeliveriesRouter } from "./alert-deliveries";
import { alertEventsRouter } from "./alert-events";

export const alertRouter = router({
  ...alertRulesRouter._def.procedures,
  ...alertChannelsRouter._def.procedures,
  ...alertWebhooksRouter._def.procedures,
  ...alertDeliveriesRouter._def.procedures,
  ...alertEventsRouter._def.procedures,
});
