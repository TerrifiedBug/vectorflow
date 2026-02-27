import { router } from "./init";
import { teamRouter } from "@/server/routers/team";
import { environmentRouter } from "@/server/routers/environment";

export const appRouter = router({
  team: teamRouter,
  environment: environmentRouter,
});

export type AppRouter = typeof appRouter;
