import { z } from "zod";
import { ulid } from "ulid";
import { router, protectedProcedure, requireSuperAdmin } from "@/trpc/init";
import { withAudit } from "@/server/middleware/audit";
import { prisma } from "@/lib/prisma";
import { sendTelemetryHeartbeat } from "@/server/services/telemetry-sender";

const SETTINGS_ID = "singleton";

export const telemetryRouter = router({
  get: protectedProcedure
    .use(requireSuperAdmin())
    .query(async () => {
      const settings = await prisma.systemSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      return { enabled: settings?.telemetryEnabled ?? false };
    }),

  update: protectedProcedure
    .use(requireSuperAdmin())
    .use(withAudit("telemetry.update", "SystemSettings"))
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const settings = await prisma.systemSettings.findUnique({
        where: { id: SETTINGS_ID },
      });

      const isFirstEnable =
        input.enabled &&
        (!settings || !settings.telemetryInstanceId || !settings.telemetryEnabledAt);

      const data: {
        telemetryEnabled: boolean;
        telemetryInstanceId?: string;
        telemetryEnabledAt?: Date;
      } = { telemetryEnabled: input.enabled };

      if (isFirstEnable) {
        data.telemetryInstanceId = ulid();
        data.telemetryEnabledAt = new Date();
      }

      await prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data,
      });

      // Fire-and-forget: send an immediate heartbeat so the instance appears on
      // Pulse without waiting for the next cron tick.
      if (input.enabled) {
        void Promise.resolve(sendTelemetryHeartbeat()).catch(() => {});
      }

      return { ok: true };
    }),
});
