import { z } from "zod";
import { ulid } from "ulid";
import { router, protectedProcedure, requireOrgAdmin } from "@/trpc/init";
import { withAudit } from "@/server/middleware/audit";
import { getOrgSettings, updateOrgSettings } from "@/lib/org-settings";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";
import { sendTelemetryHeartbeat } from "@/server/services/telemetry-sender";

export const telemetryRouter = router({
  get: protectedProcedure
    .use(requireOrgAdmin())
    .query(async ({ ctx }) => {
      const settings = await getOrgSettings(ctx.organizationId ?? DEFAULT_ORG_ID);
      return { enabled: settings.telemetryEnabled };
    }),

  update: protectedProcedure
    .use(requireOrgAdmin())
    .use(withAudit("telemetry.update", "OrganizationSettings"))
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId ?? DEFAULT_ORG_ID;
      const settings = await getOrgSettings(orgId);

      const isFirstEnable =
        input.enabled &&
        (!settings.telemetryInstanceId || !settings.telemetryEnabledAt);

      const data: {
        telemetryEnabled: boolean;
        telemetryInstanceId?: string;
        telemetryEnabledAt?: Date;
      } = { telemetryEnabled: input.enabled };

      if (isFirstEnable) {
        data.telemetryInstanceId = ulid();
        data.telemetryEnabledAt = new Date();
      }

      await updateOrgSettings(orgId, data);

      // Fire-and-forget: send an immediate heartbeat so the instance appears on
      // Pulse without waiting for the next cron tick.
      if (input.enabled) {
        void Promise.resolve(sendTelemetryHeartbeat()).catch(() => {});
      }

      return { ok: true };
    }),
});
