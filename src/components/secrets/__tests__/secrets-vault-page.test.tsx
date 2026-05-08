// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class FileReaderMock {
  result: string | null = null;
  onload: null | (() => void) = null;

  readAsText() {
    this.result = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----";
    this.onload?.();
  }
}

Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(globalThis, "FileReader", {
  writable: true,
  value: FileReaderMock,
});

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  writable: true,
  value: vi.fn(),
});

const {
  mockCreateSecretMutate,
  mockUpdateSecretMutate,
  mockDeleteSecretMutate,
  mockUploadCertificateMutate,
  mockDeleteCertificateMutate,
  mockBundleCreateMutate,
  mockBundleUpdateMutate,
  mockBundleDeleteMutate,
  mockInvalidateQueries,
  mockFetchQuery,
  mockRouterPush,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  mockCreateSecretMutate: vi.fn(),
  mockUpdateSecretMutate: vi.fn(),
  mockDeleteSecretMutate: vi.fn(),
  mockUploadCertificateMutate: vi.fn(),
  mockDeleteCertificateMutate: vi.fn(),
  mockBundleCreateMutate: vi.fn(),
  mockBundleUpdateMutate: vi.fn(),
  mockBundleDeleteMutate: vi.fn(),
  mockInvalidateQueries: vi.fn(),
  mockFetchQuery: vi.fn(),
  mockRouterPush: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const queryState = vi.hoisted(() => ({
  envs: [
    { id: "env-1", name: "prod-eu" },
    { id: "env-2", name: "staging" },
  ],
  secretsByEnvironment: {
    "env-1": [
      {
        id: "secret-1",
        name: "API_KEY",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-07T00:00:00.000Z"),
      },
    ],
    "env-2": [],
  } as Record<string, Array<{ id: string; name: string; createdAt: Date; updatedAt: Date }>>,
  certificatesByEnvironment: {
    "env-1": [
      {
        id: "cert-1",
        name: "client-cert",
        filename: "client.pem",
        fileType: "cert",
        createdAt: new Date("2026-04-20T00:00:00.000Z").toISOString(),
        expiryDate: new Date("2026-06-20T00:00:00.000Z").toISOString(),
        daysUntilExpiry: 12,
      },
    ],
    "env-2": [],
  } as Record<string, Array<{ id: string; name: string; filename: string; fileType: "ca" | "cert" | "key"; createdAt: string; expiryDate: string | null; daysUntilExpiry: number | null }>>,
  bundlesByEnvironment: {
    "env-1": [
      {
        id: "bundle-1",
        name: "mtls-prod",
        environmentId: "env-1",
        caId: null,
        certId: "cert-1",
        keyId: null,
        createdAt: new Date("2026-05-03T00:00:00.000Z").toISOString(),
        updatedAt: new Date("2026-05-05T00:00:00.000Z").toISOString(),
        ca: null,
        cert: { id: "cert-1", name: "client-cert", filename: "client.pem", fileType: "cert" },
        key: null,
      },
    ],
    "env-2": [],
  } as Record<string, Array<{
    id: string;
    name: string;
    environmentId: string;
    caId: string | null;
    certId: string | null;
    keyId: string | null;
    createdAt: string;
    updatedAt: string;
    ca: { id: string; name: string; filename: string; fileType: "ca" | "cert" | "key" } | null;
    cert: { id: string; name: string; filename: string; fileType: "ca" | "cert" | "key" } | null;
    key: { id: string; name: string; filename: string; fileType: "ca" | "cert" | "key" } | null;
  }>>,
  usageBySecret: {
    "secret-1:env-1": {
      count: 1,
      pipelineCount: 1,
      refs: [
        {
          id: "ref-1",
          componentType: "http.source",
          pipeline: {
            id: "pipe-1",
            name: "payments",
            environment: { id: "env-1", name: "prod-eu" },
          },
        },
      ],
    },
  } as Record<string, { count: number; pipelineCount: number; refs: Array<{ id: string; componentType: string; pipeline: { id: string; name: string; environment: { id: string; name: string } } }> }>,
  usageByCertificate: {
    "cert-1:env-1": {
      count: 1,
      pipelineCount: 1,
      refs: [
        {
          id: "cert-ref-1",
          componentType: "kafka.sink",
          pipeline: {
            id: "pipe-cert-1",
            name: "tls-delivery",
            environment: { id: "env-1", name: "prod-eu" },
          },
        },
      ],
    },
  } as Record<string, { count: number; pipelineCount: number; refs: Array<{ id: string; componentType: string; pipeline: { id: string; name: string; environment: { id: string; name: string } } }> }>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("@/stores/team-store", () => ({
  useTeamStore: (selector: (state: { selectedTeamId: string }) => unknown) =>
    selector({ selectedTeamId: "team-1" }),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    environment: {
      list: {
        queryOptions: (input: { teamId: string }) => ({ __name: "environment.list", input, queryKey: ["environment.list", input.teamId] }),
      },
    },
    secret: {
      list: {
        queryOptions: (input: { environmentId: string }) => ({ __name: "secret.list", input, queryKey: ["secret.list", input.environmentId] }),
        queryKey: (input: { environmentId: string }) => ["secret.list", input.environmentId],
      },
      usage: {
        queryOptions: (input: { secretId: string; environmentId: string }) => ({ __name: "secret.usage", input, queryKey: ["secret.usage", input.secretId, input.environmentId] }),
        queryKey: (input: { secretId: string; environmentId: string }) => ["secret.usage", input.secretId, input.environmentId],
      },
      create: {
        mutationOptions: (opts: object) => ({ __name: "secret.create", ...opts }),
      },
      update: {
        mutationOptions: (opts: object) => ({ __name: "secret.update", ...opts }),
      },
      delete: {
        mutationOptions: (opts: object) => ({ __name: "secret.delete", ...opts }),
      },
    },
    certificate: {
      list: {
        queryOptions: (input: { environmentId: string }) => ({ __name: "certificate.list", input, queryKey: ["certificate.list", input.environmentId] }),
        queryKey: (input: { environmentId: string }) => ["certificate.list", input.environmentId],
      },
      usage: {
        queryOptions: (input: { certificateId: string; environmentId: string }) => ({ __name: "certificate.usage", input, queryKey: ["certificate.usage", input.certificateId, input.environmentId] }),
        queryKey: (input: { certificateId: string; environmentId: string }) => ["certificate.usage", input.certificateId, input.environmentId],
      },
      upload: {
        mutationOptions: (opts: object) => ({ __name: "certificate.upload", ...opts }),
      },
      delete: {
        mutationOptions: (opts: object) => ({ __name: "certificate.delete", ...opts }),
      },
      getData: {
        queryOptions: (input: { id: string; environmentId: string }) => ({ __name: "certificate.getData", input, queryKey: ["certificate.getData", input.id, input.environmentId] }),
      },
      bundleList: {
        queryOptions: (input: { environmentId: string }) => ({ __name: "certificate.bundleList", input, queryKey: ["certificate.bundleList", input.environmentId] }),
        queryKey: (input: { environmentId: string }) => ["certificate.bundleList", input.environmentId],
      },
      bundleCreate: {
        mutationOptions: (opts: object) => ({ __name: "certificate.bundleCreate", ...opts }),
      },
      bundleUpdate: {
        mutationOptions: (opts: object) => ({ __name: "certificate.bundleUpdate", ...opts }),
      },
      bundleDelete: {
        mutationOptions: (opts: object) => ({ __name: "certificate.bundleDelete", ...opts }),
      },
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { __name?: string; input?: { teamId?: string } }) => {
    if (options.__name === "environment.list") {
      return {
        data: queryState.envs,
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
      };
    }
    return { data: undefined, isPending: false, isError: false, isSuccess: true, error: null };
  },
  useQueries: ({ queries }: { queries: Array<{ __name?: string; input?: { environmentId?: string; secretId?: string; certificateId?: string } }> }) =>
    queries.map((query) => {
      if (query.__name === "secret.list") {
        return {
          data: queryState.secretsByEnvironment[query.input?.environmentId ?? ""] ?? [],
          isPending: false,
          isError: false,
          isSuccess: true,
          error: null,
        };
      }
      if (query.__name === "certificate.list") {
        return {
          data: queryState.certificatesByEnvironment[query.input?.environmentId ?? ""] ?? [],
          isPending: false,
          isError: false,
          isSuccess: true,
          error: null,
        };
      }
      if (query.__name === "certificate.bundleList") {
        return {
          data: queryState.bundlesByEnvironment[query.input?.environmentId ?? ""] ?? [],
          isPending: false,
          isError: false,
          isSuccess: true,
          error: null,
        };
      }
      if (query.__name === "secret.usage") {
        const key = `${query.input?.secretId}:${query.input?.environmentId}`;
        return {
          data: queryState.usageBySecret[key] ?? { count: 0, pipelineCount: 0, refs: [] },
          isPending: false,
          isError: false,
          isSuccess: true,
          error: null,
        };
      }
      if (query.__name === "certificate.usage") {
        const key = `${query.input?.certificateId}:${query.input?.environmentId}`;
        return {
          data: queryState.usageByCertificate[key] ?? { count: 0, pipelineCount: 0, refs: [] },
          isPending: false,
          isError: false,
          isSuccess: true,
          error: null,
        };
      }
      return { data: undefined, isPending: false, isError: false, isSuccess: true, error: null };
    }),
  useMutation: (options: { __name?: string }) => {
    if (options.__name === "secret.create") {
      return { mutate: mockCreateSecretMutate, isPending: false };
    }
    if (options.__name === "secret.update") {
      return { mutate: mockUpdateSecretMutate, isPending: false };
    }
    if (options.__name === "secret.delete") {
      return { mutate: mockDeleteSecretMutate, isPending: false };
    }
    if (options.__name === "certificate.upload") {
      return { mutate: mockUploadCertificateMutate, isPending: false };
    }
    if (options.__name === "certificate.bundleCreate") {
      return { mutate: mockBundleCreateMutate, isPending: false };
    }
    if (options.__name === "certificate.bundleUpdate") {
      return { mutate: mockBundleUpdateMutate, isPending: false };
    }
    if (options.__name === "certificate.bundleDelete") {
      return { mutate: mockBundleDeleteMutate, isPending: false };
    }
    return { mutate: mockDeleteCertificateMutate, isPending: false };
  },
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    fetchQuery: mockFetchQuery,
  }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" role="menuitem" onClick={onClick}>
      {children}
    </button>
  ),
}));


vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { SecretsVaultPage } from "@/components/secrets/secrets-vault-page";

describe("SecretsVaultPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchQuery.mockResolvedValue({ data: "pem-body", filename: "client.pem" });
    vi.stubGlobal("open", vi.fn());
    vi.stubGlobal(
      "URL",
      Object.assign(globalThis.URL ?? {}, {
        createObjectURL: vi.fn(() => "blob:cert"),
        revokeObjectURL: vi.fn(),
      })
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders secret and certificate rows and shows certificate usage details", async () => {
    render(<SecretsVaultPage />);

    expect(await screen.findByRole("button", { name: /api_key/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /client-cert/i })).toBeInTheDocument();
    expect(screen.getByText("SECRET")).toBeInTheDocument();
    expect(screen.getByText("CERT")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /client-cert/i }));

    expect((await screen.findAllByText("client.pem")).length).toBeGreaterThan(0);
    expect(screen.getByText(/tls-delivery/i)).toBeInTheDocument();
    expect(screen.getByText(/kafka\.sink/i)).toBeInTheDocument();
  });

  it("creates a secret from the header dropdown", async () => {
    render(<SecretsVaultPage />);

    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /new secret/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "NEW_SECRET" } });
    fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value: "super-secret" } });
    fireEvent.click(screen.getByRole("button", { name: /create secret/i }));

    expect(mockCreateSecretMutate).toHaveBeenCalledWith({
      environmentId: "env-1",
      name: "NEW_SECRET",
      value: "super-secret",
    });
  });

  it("uploads a certificate from the header dropdown", async () => {
    render(<SecretsVaultPage />);

    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /upload certificate/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "EDGE_CERT" } });
    fireEvent.change(screen.getByLabelText(/^file$/i), {
      target: {
        files: [
          new File(
            ["-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----"],
            "edge.pem",
            { type: "application/x-pem-file" }
          ),
        ],
      },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^upload$/i })).not.toBeDisabled();
    });
    fireEvent.submit(screen.getByRole("button", { name: /^upload$/i }).closest("form")!);

    await waitFor(() => {
      expect(mockUploadCertificateMutate).toHaveBeenCalledWith({
        environmentId: "env-1",
        name: "EDGE_CERT",
        filename: "edge.pem",
        fileType: "cert",
        dataBase64: Buffer.from("-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----").toString("base64"),
      });
    });

  });

  it("downloads certificate PEM data for the selected certificate", async () => {
    render(<SecretsVaultPage />);

    fireEvent.click(await screen.findByRole("button", { name: /client-cert/i }));
    fireEvent.click(await screen.findByRole("button", { name: /download pem/i }));

    await waitFor(() => {
      expect(mockFetchQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          __name: "certificate.getData",
          input: { id: "cert-1", environmentId: "env-1" },
        })
      );
    });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("navigates to audit with certificate filters", async () => {
    render(<SecretsVaultPage />);

    fireEvent.click(await screen.findByRole("button", { name: /client-cert/i }));
    fireEvent.click(await screen.findByRole("button", { name: /view audit/i }));

    expect(mockRouterPush).toHaveBeenCalledWith("/audit?entityType=Certificate&search=cert-1");
  });

  it("shows bundles grouped by environment and creates a new bundle", async () => {
    render(<SecretsVaultPage />);

    fireEvent.click(screen.getByRole("tab", { name: /bundles/i }));

    expect(screen.getAllByText("prod-eu").length).toBeGreaterThan(0);
    expect(screen.getByText("mtls-prod")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^new$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /new bundle/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "shared-ca-only" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^create bundle$/i }).at(-1)!);

    expect(mockBundleCreateMutate).toHaveBeenCalledWith({
      environmentId: "env-1",
      name: "shared-ca-only",
      caId: null,
      certId: null,
      keyId: null,
    });
  });

});
