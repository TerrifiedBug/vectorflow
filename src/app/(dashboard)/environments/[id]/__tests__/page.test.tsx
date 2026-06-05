// @vitest-environment jsdom
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    default: actual,
    use: (value: unknown) =>
      value && typeof value === "object" && "then" in (value as Record<string, unknown>)
        ? { id: "env-1" }
        : value,
  };
});

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=secrets"),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const mutateMock = vi.fn();

const environment = vi.hoisted(() => ({
  id: "env-1",
  name: "Production",
  team: { id: "team-1", name: "Test" },
  teamId: "team-1",
  gitOpsMode: "off",
  _count: { nodes: 1, pipelines: 2 },
  nodes: [
    {
      id: "node-1",
      name: "node-1",
      host: "host",
      apiPort: 8686,
      status: "HEALTHY",
      lastSeen: new Date().toISOString(),
    },
  ],
  requireDeployApproval: false,
  hasEnrollmentToken: false,
  hasGitToken: false,
  hasWebhookSecret: false,
  enrollmentTokenHint: null,
  gitRepoUrl: null,
  gitBranch: null,
  gitProvider: null,
  secretBackend: "VAULT",
  secretBackendConfig: {
    address: "https://vault.example.com",
    authMethod: "token",
    mountPath: "kv",
    hasToken: true,
    basePath: "vectorflow",
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { __name?: string }) => {
    switch (options.__name) {
      case "environment.get":
        return { data: environment, isLoading: false, isError: false, refetch: vi.fn() };
      case "team.teamRole":
        return { data: { role: "ADMIN" }, isLoading: false, isError: false, refetch: vi.fn() };
      default:
        return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    }
  },
  useMutation: () => ({ mutate: mutateMock, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    environment: {
      get: { queryOptions: (input: { id: string }) => ({ __name: "environment.get", input }), queryKey: (input?: unknown) => ["environment.get", input] },
      update: { mutationOptions: (options: unknown) => options },
      delete: { mutationOptions: (options: unknown) => options },
      generateEnrollmentToken: { mutationOptions: (options: unknown) => options },
      revokeEnrollmentToken: { mutationOptions: (options: unknown) => options },
      testVaultConnection: { mutationOptions: (options: unknown) => options },
      getLakeBucket: {
        queryOptions: (input: { environmentId: string }) => ({ __name: "environment.getLakeBucket", input }),
        queryKey: (input?: unknown) => ["environment.getLakeBucket", input],
      },
      setLakeBucket: { mutationOptions: (options: unknown) => options },
      clearLakeBucket: { mutationOptions: (options: unknown) => options },
    },
    team: {
      teamRole: { queryOptions: (input: { teamId: string }) => ({ __name: "team.teamRole", input }) },
    },
  }),
}));

vi.mock("@/stores/team-store", () => ({
  useTeamStore: (selector: (state: { selectedTeamId: string }) => string) => selector({ selectedTeamId: "team-1" }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/environment/git-sync-section", () => ({ GitSyncSection: () => <div>Git sync</div> }));
vi.mock("@/components/environment/git-sync-status", () => ({ GitSyncStatus: () => <div>Git sync status</div> }));
vi.mock("@/components/demo-disabled", () => ({
  DemoDisabledNotice: ({ message }: { message: string }) => <div>{message}</div>,
  DemoDisabledBadge: () => <div>Demo disabled</div>,
}));
vi.mock("@/lib/is-demo-mode", () => ({ isDemoMode: () => false }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div role="listbox">{children}</div>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <div role="option" data-value={value}>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button" role="combobox">{children}</button>,
  SelectValue: () => null,
}));

import EnvironmentDetailPage from "../page";

describe("environment detail secret backend actions", () => {
  afterEach(() => {
    cleanup();
    mutateMock.mockReset();
    environment.secretBackend = "VAULT";
  });

  it("only offers implemented secret backends while editing", async () => {
    render(
      <React.Suspense fallback={<div>loading</div>}>
        <EnvironmentDetailPage params={Promise.resolve({ id: "env-1" })} />
      </React.Suspense>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: /secret backend/i }));

    const listbox = screen.getAllByRole("listbox")[0]!;

    expect(within(listbox).getByText("Built-in (VectorFlow delivers secrets as env vars)")).toBeInTheDocument();
    expect(within(listbox).getByText("HashiCorp Vault")).toBeInTheDocument();
    expect(within(listbox).queryByText("AWS Secrets Manager")).not.toBeInTheDocument();
    expect(within(listbox).queryByText("Exec (custom script)")).not.toBeInTheDocument();
  });

  it("labels existing unimplemented secret backends as unsupported", async () => {
    environment.secretBackend = "AWS_SM";

    render(
      <React.Suspense fallback={<div>loading</div>}>
        <EnvironmentDetailPage params={Promise.resolve({ id: "env-1" })} />
      </React.Suspense>,
    );

    expect(await screen.findByText("AWS Secrets Manager (unsupported)")).toBeInTheDocument();
  });

  it("shows local save and cancel actions inside the secret backend section while editing", async () => {
    render(
      <React.Suspense fallback={<div>loading</div>}>
        <EnvironmentDetailPage params={Promise.resolve({ id: "env-1" })} />
      </React.Suspense>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    const secretBackendTab = screen.getByRole("tab", { name: /secret backend/i });
    fireEvent.click(secretBackendTab);

    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    expect(saveButtons).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(2);
  });
  it("hydrates and submits the Vault secret path field", async () => {
    render(
      <React.Suspense fallback={<div>loading</div>}>
        <EnvironmentDetailPage params={Promise.resolve({ id: "env-1" })} />
      </React.Suspense>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: /secret backend/i }));

    const secretPathInput = screen.getByLabelText("Secret Path");
    expect(secretPathInput).toHaveValue("vectorflow");

    fireEvent.change(secretPathInput, { target: { value: "vectorflow-prod" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);

    expect(mutateMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "env-1",
      secretBackend: "VAULT",
      secretBackendConfig: expect.objectContaining({
        basePath: "vectorflow-prod",
      }),
    }));
  });
});
