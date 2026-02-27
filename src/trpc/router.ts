import { router } from "./init";
import { teamRouter } from "@/server/routers/team";
import { environmentRouter } from "@/server/routers/environment";
import { fleetRouter } from "@/server/routers/fleet";
import { pipelineRouter } from "@/server/routers/pipeline";

export const appRouter = router({
  team: teamRouter,
  environment: environmentRouter,
  fleet: fleetRouter,
  pipeline: pipelineRouter,
});

export type AppRouter = typeof appRouter;
