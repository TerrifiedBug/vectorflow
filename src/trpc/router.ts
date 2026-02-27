import { router } from "./init";
import { teamRouter } from "@/server/routers/team";
import { environmentRouter } from "@/server/routers/environment";
import { fleetRouter } from "@/server/routers/fleet";
import { pipelineRouter } from "@/server/routers/pipeline";
import { validatorRouter } from "@/server/routers/validator";
import { auditRouter } from "@/server/routers/audit";
import { deployRouter } from "@/server/routers/deploy";

export const appRouter = router({
  team: teamRouter,
  environment: environmentRouter,
  fleet: fleetRouter,
  pipeline: pipelineRouter,
  validator: validatorRouter,
  audit: auditRouter,
  deploy: deployRouter,
});

export type AppRouter = typeof appRouter;
