import { router } from "./init";
import { teamRouter } from "@/server/routers/team";
import { environmentRouter } from "@/server/routers/environment";
import { fleetRouter } from "@/server/routers/fleet";
import { pipelineRouter } from "@/server/routers/pipeline";
import { validatorRouter } from "@/server/routers/validator";
import { auditRouter } from "@/server/routers/audit";
import { deployRouter } from "@/server/routers/deploy";
import { vrlRouter } from "@/server/routers/vrl";
import { templateRouter } from "@/server/routers/template";
import { settingsRouter } from "@/server/routers/settings";
import { dashboardRouter } from "@/server/routers/dashboard";
import { metricsRouter } from "@/server/routers/metrics";
import { userRouter } from "@/server/routers/user";
import { adminRouter } from "@/server/routers/admin";

export const appRouter = router({
  team: teamRouter,
  environment: environmentRouter,
  fleet: fleetRouter,
  pipeline: pipelineRouter,
  validator: validatorRouter,
  audit: auditRouter,
  deploy: deployRouter,
  vrl: vrlRouter,
  template: templateRouter,
  settings: settingsRouter,
  dashboard: dashboardRouter,
  metrics: metricsRouter,
  user: userRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
