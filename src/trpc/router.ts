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
import { secretRouter } from "@/server/routers/secret";
import { certificateRouter } from "@/server/routers/certificate";
import { vrlSnippetRouter } from "@/server/routers/vrl-snippet";
import { alertRouter } from "@/server/routers/alert";
import { serviceAccountRouter } from "@/server/routers/service-account";
import { userPreferenceRouter } from "@/server/routers/user-preference";
import { sharedComponentRouter } from "@/server/routers/shared-component";
import { aiRouter } from "@/server/routers/ai";
import { pipelineGroupRouter } from "@/server/routers/pipeline-group";
import { nodeGroupRouter } from "@/server/routers/node-group";
import { stagedRolloutRouter } from "@/server/routers/staged-rollout";
import { pipelineDependencyRouter } from "@/server/routers/pipeline-dependency";
import { webhookEndpointRouter } from "@/server/routers/webhook-endpoint";
import { promotionRouter } from "@/server/routers/promotion";
import { filterPresetRouter } from "@/server/routers/filter-preset";
import { gitSyncRouter } from "@/server/routers/git-sync";
import { migrationRouter } from "@/server/routers/migration";
import { analyticsRouter } from "@/server/routers/analytics";

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
  secret: secretRouter,
  certificate: certificateRouter,
  vrlSnippet: vrlSnippetRouter,
  alert: alertRouter,
  serviceAccount: serviceAccountRouter,
  userPreference: userPreferenceRouter,
  sharedComponent: sharedComponentRouter,
  ai: aiRouter,
  pipelineGroup: pipelineGroupRouter,
  nodeGroup: nodeGroupRouter,
  stagedRollout: stagedRolloutRouter,
  pipelineDependency: pipelineDependencyRouter,
  webhookEndpoint: webhookEndpointRouter,
  promotion: promotionRouter,
  filterPreset: filterPresetRouter,
  gitSync: gitSyncRouter,
<<<<<<< HEAD
  migration: migrationRouter,
  analytics: analyticsRouter,
});

export type AppRouter = typeof appRouter;
