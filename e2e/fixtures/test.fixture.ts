import { test as base } from "@playwright/test";
import { LoginPage } from "../pages/login.page";
import { PipelinesPage } from "../pages/pipelines.page";
import { PipelineEditorPage } from "../pages/pipeline-editor.page";
import { FleetPage } from "../pages/fleet.page";
import { AlertsPage } from "../pages/alerts.page";
import { SidebarComponent } from "../pages/components/sidebar.component";
import { ToastComponent } from "../pages/components/toast.component";
import { DeployDialogComponent } from "../pages/components/deploy-dialog.component";

interface E2EFixtures {
  loginPage: LoginPage;
  pipelinesPage: PipelinesPage;
  pipelineEditor: PipelineEditorPage;
  fleetPage: FleetPage;
  alertsPage: AlertsPage;
  sidebar: SidebarComponent;
  toast: ToastComponent;
  deployDialog: DeployDialogComponent;
}

export const test = base.extend<E2EFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  pipelinesPage: async ({ page }, use) => {
    await use(new PipelinesPage(page));
  },
  pipelineEditor: async ({ page }, use) => {
    await use(new PipelineEditorPage(page));
  },
  fleetPage: async ({ page }, use) => {
    await use(new FleetPage(page));
  },
  alertsPage: async ({ page }, use) => {
    await use(new AlertsPage(page));
  },
  sidebar: async ({ page }, use) => {
    await use(new SidebarComponent(page));
  },
  toast: async ({ page }, use) => {
    await use(new ToastComponent(page));
  },
  deployDialog: async ({ page }, use) => {
    await use(new DeployDialogComponent(page));
  },
});

export { expect } from "@playwright/test";
