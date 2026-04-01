export const TEST_USER = {
  email: "e2e@test.local",
  password: "TestPassword123!",
  name: "E2E Test User",
} as const;

export const TEST_TEAM = {
  name: "E2E Test Team",
} as const;

export const TEST_ENVIRONMENT = {
  name: "e2e-test-env",
} as const;

export const TEST_PIPELINE = {
  name: "E2E Test Pipeline",
  description: "Pipeline created by E2E seed script",
} as const;

export const TEST_NODE = {
  name: "e2e-node-01",
  host: "e2e-host-01.local",
  apiPort: 8686,
} as const;

export const TEST_ALERT_RULE = {
  name: "E2E Error Rate Alert",
} as const;

export const SELECTORS = {
  sidebar: {
    nav: '[data-slot="sidebar"]',
    menuButton: (title: string) => `a:has(span:text("${title}"))`,
  },
  toast: {
    container: '[data-sonner-toaster]',
    success: '[data-type="success"]',
    error: '[data-type="error"]',
  },
} as const;
