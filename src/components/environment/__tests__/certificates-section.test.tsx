// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const {
  mockBundleCreateMutate,
  mockBundleDeleteMutate,
  mockInvalidateQueries,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  mockBundleCreateMutate: vi.fn(),
  mockBundleDeleteMutate: vi.fn(),
  mockInvalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const queryState = vi.hoisted(() => ({
  certificates: [
    {
      id: "ca-1",
      name: "root-ca",
      filename: "root.pem",
      fileType: "ca",
      createdAt: new Date("2026-05-01T00:00:00Z").toISOString(),
      expiryDate: new Date("2026-06-01T00:00:00Z").toISOString(),
      daysUntilExpiry: 24,
    },
    {
      id: "cert-1",
      name: "client-cert",
      filename: "client.pem",
      fileType: "cert",
      createdAt: new Date("2026-05-01T00:00:00Z").toISOString(),
      expiryDate: new Date("2026-06-01T00:00:00Z").toISOString(),
      daysUntilExpiry: 24,
    },
  ],
  bundles: [
    {
      id: "bundle-1",
      name: "shared-ca-only",
      environmentId: "env-1",
      caId: "ca-1",
      certId: null,
      keyId: null,
      createdAt: new Date("2026-05-02T00:00:00Z").toISOString(),
      updatedAt: new Date("2026-05-02T00:00:00Z").toISOString(),
      ca: { id: "ca-1", name: "root-ca", filename: "root.pem", fileType: "ca" },
      cert: null,
      key: null,
    },
  ],
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    certificate: {
      list: {
        queryOptions: (input: { environmentId: string }) => ({ __name: "certificate.list", input, queryKey: ["certificate.list", input.environmentId] }),
        queryKey: (input: { environmentId: string }) => ["certificate.list", input.environmentId],
      },
      bundleList: {
        queryOptions: (input: { environmentId: string }) => ({ __name: "certificate.bundleList", input, queryKey: ["certificate.bundleList", input.environmentId] }),
        queryKey: (input: { environmentId: string }) => ["certificate.bundleList", input.environmentId],
      },
      bundleCreate: {
        mutationOptions: (opts: object) => ({ __name: "certificate.bundleCreate", ...opts }),
      },
      bundleDelete: {
        mutationOptions: (opts: object) => ({ __name: "certificate.bundleDelete", ...opts }),
      },
      upload: {
        mutationOptions: (opts: object) => ({ __name: "certificate.upload", ...opts }),
      },
      delete: {
        mutationOptions: (opts: object) => ({ __name: "certificate.delete", ...opts }),
      },
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { __name?: string }) => {
    if (options.__name === "certificate.list") {
      return { data: queryState.certificates, isLoading: false, isPending: false };
    }
    if (options.__name === "certificate.bundleList") {
      return { data: queryState.bundles, isLoading: false, isPending: false };
    }
    return { data: undefined, isLoading: false, isPending: false };
  },
  useMutation: (options: { __name?: string }) => {
    if (options.__name === "certificate.bundleCreate") {
      return { mutate: mockBundleCreateMutate, isPending: false };
    }
    if (options.__name === "certificate.bundleDelete") {
      return { mutate: mockBundleDeleteMutate, isPending: false };
    }
    return { mutate: vi.fn(), isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { CertificatesSection } from "../certificates-section";

describe("CertificatesSection bundles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("shows existing bundles and creates a new bundle", () => {
    render(<CertificatesSection environmentId="env-1" />);

    expect(screen.getByText("shared-ca-only")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /create bundle/i })[0]!);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "mtls-prod" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^create bundle$/i }).at(-1)!);

    expect(mockBundleCreateMutate).toHaveBeenCalledWith({
      environmentId: "env-1",
      name: "mtls-prod",
      caId: null,
      certId: null,
      keyId: null,
    });
  });
});
