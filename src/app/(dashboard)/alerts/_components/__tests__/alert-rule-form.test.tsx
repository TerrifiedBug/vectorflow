// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { createRuleMutate, updateRuleMutate, routerPush } = vi.hoisted(() => ({
  createRuleMutate: vi.fn(),
  updateRuleMutate: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/stores/team-store", () => ({
  useTeamStore: (selector: (state: { selectedTeamId: string }) => unknown) =>
    selector({ selectedTeamId: "team-1" }),
}));

vi.mock("@/stores/environment-store", () => ({
  useEnvironmentStore: () => ({ selectedEnvironmentId: "env-1" }),
}));

vi.mock("@/hooks/use-debounce", () => ({
  useDebounce: (value: unknown) => value,
}));

vi.mock("@/components/alerts/alert-rule-preview", () => ({
  AlertRulePreview: () => <div data-testid="alert-rule-preview" />,
}));

vi.mock("@/components/alerts/alert-rule-slack-preview", () => ({
  AlertRuleSlackPreview: () => <div data-testid="alert-rule-slack-preview" />,
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    pipeline: {
      list: {
        queryOptions: () => ({
          queryKey: ["pipeline", "list"],
          queryFn: () => ({ pipelines: [] }),
        }),
      },
    },
    alert: {
      listChannels: {
        queryOptions: () => ({
          queryKey: ["alert", "listChannels"],
          queryFn: () => [],
        }),
      },
      findSimilar: {
        queryOptions: () => ({
          queryKey: ["alert", "findSimilar"],
          queryFn: () => ({ matches: [] }),
        }),
      },
      createRule: {
        mutationOptions: (options: unknown) => ({
          ...(options as Record<string, unknown>),
          mutationKey: ["alert", "createRule"],
        }),
      },
      updateRule: {
        mutationOptions: (options: unknown) => ({
          ...(options as Record<string, unknown>),
          mutationKey: ["alert", "updateRule"],
        }),
      },
      listRules: { queryKey: () => ["alert", "listRules"] },
      getRule: { queryKey: () => ["alert", "getRule"] },
      testRule: {
        queryOptions: () => ({
          queryKey: ["alert", "testRule"],
          queryFn: () => ({ supported: true, wouldHaveFired: 0 }),
        }),
      },
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryFn, enabled = true }: { queryFn: () => unknown; enabled?: boolean }) => {
    if (!enabled) return { data: undefined, isLoading: false };
    return { data: queryFn(), isLoading: false };
  },
  useMutation: (options: { mutationKey?: string[] }) => ({
    mutate: options.mutationKey?.includes("createRule") ? createRuleMutate : updateRuleMutate,
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    fetchQuery: vi.fn(),
  }),
}));

import { AlertRuleForm, type AlertRuleFormValues } from "@/components/alerts/alert-rule-form";

const formValues: AlertRuleFormValues = {
  name: "High CPU",
  description: "Page the owning team when CPU remains high.",
  severity: "warning",
  pipelineId: "",
  metric: "cpu_usage",
  condition: "gt",
  threshold: "90",
  durationMinutes: "5",
  cooldown: "15",
  channelIds: [],
};

describe("AlertRuleForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("includes the entered description in create payloads", () => {
    const { container, getByRole } = render(
      <AlertRuleForm mode="create" initialValues={formValues} />,
    );
    const description = container.querySelector("textarea");
    expect(description).not.toBeNull();

    fireEvent.change(description!, {
      target: { value: "Escalate to platform ops with recent node metrics." },
    });
    fireEvent.click(getByRole("button", { name: /create rule/i }));

    expect(createRuleMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Escalate to platform ops with recent node metrics.",
        suggestedAction: "Escalate to platform ops with recent node metrics.",
      }),
    );
  });

  it("includes the entered description in update payloads", () => {
    const { container, getByRole } = render(
      <AlertRuleForm
        mode="edit"
        ruleId="rule-1"
        ruleName="High CPU"
        environmentId="env-1"
        initialValues={formValues}
      />,
    );
    const description = container.querySelector("textarea");
    expect(description).not.toBeNull();

    fireEvent.change(description!, {
      target: { value: "Update the incident channel before restarting services." },
    });
    fireEvent.click(getByRole("button", { name: /save changes/i }));

    expect(updateRuleMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rule-1",
        description: "Update the incident channel before restarting services.",
        suggestedAction: "Update the incident channel before restarting services.",
      }),
    );
  });

  it("preserves suggestedAction as legacy description fallback in edit mapping", () => {
    const editPageSource = readFileSync("src/app/(dashboard)/alerts/[id]/edit/page.tsx", "utf8");

    expect(editPageSource).toContain("description: rule.description ?? rule.suggestedAction ?? \"\"");
  });
});
