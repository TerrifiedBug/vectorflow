// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const createMutateMock = vi.fn();
const invalidateQueriesMock = vi.fn();
const onChangeMock = vi.fn();

const queryState = {
  backend: "BUILTIN" as "BUILTIN" | "VAULT",
  vaultLoading: false,
  vaultError: false,
  builtinSecrets: [
    { id: "secret-1", name: "API_KEY" },
  ],
  vaultSecrets: ["OPENSEARCH_PROD"],
};

vi.mock("@/stores/environment-store", () => ({
  useEnvironmentStore: (selector: (state: { selectedEnvironmentId: string }) => unknown) =>
    selector({ selectedEnvironmentId: "env-1" }),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    secret: {
      list: {
        queryOptions: (input: { environmentId: string }, options?: object) => ({ __name: "secret.list", input, ...options }),
        queryKey: (input: { environmentId: string }) => ["secret.list", input.environmentId],
      },
      create: {
        mutationOptions: (options: object) => ({ __name: "secret.create", ...options }),
      },
    },
    environment: {
      listVaultSecrets: {
        queryOptions: (input: { environmentId: string }, options?: object) => ({ __name: "environment.listVaultSecrets", input, ...options }),
      },
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { __name?: string }) => {
    if (options.__name === "environment.listVaultSecrets") {
      return {
        data: queryState.vaultLoading || queryState.vaultError ? undefined : { backend: queryState.backend, secrets: queryState.backend === "VAULT" ? queryState.vaultSecrets : [] },
        isLoading: queryState.vaultLoading,
        isPending: queryState.vaultLoading,
        isError: queryState.vaultError,
        isSuccess: !queryState.vaultLoading && !queryState.vaultError,
        error: queryState.vaultError ? new Error("Vault lookup failed") : null,
      };
    }
    if (options.__name === "secret.list") {
      return {
        data: queryState.backend === "BUILTIN" ? queryState.builtinSecrets : [],
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
      };
    }
    return { data: undefined, isLoading: false, isPending: false, isError: false, isSuccess: true, error: null };
  },
  useMutation: () => ({ mutate: createMutateMock, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { SecretPickerInput } from "../secret-picker-input";

describe("SecretPickerInput", () => {
  afterEach(() => {
    cleanup();
    createMutateMock.mockReset();
    invalidateQueriesMock.mockReset();
    onChangeMock.mockReset();
    queryState.backend = "BUILTIN";
    queryState.vaultLoading = false;
    queryState.vaultError = false;
  });

  it("shows Vault field names and hides create for Vault-backed environments", async () => {
    queryState.backend = "VAULT";

    render(<SecretPickerInput value="" onChange={onChangeMock} />);

    fireEvent.click(screen.getByRole("button", { name: /select secret/i }));

    expect(await screen.findByRole("button", { name: /opensearch_prod/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create new secret/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /opensearch_prod/i }));
    expect(onChangeMock).toHaveBeenCalledWith("SECRET[OPENSEARCH_PROD]");
  });

  it("keeps create-new-secret available for built-in environments", async () => {
    queryState.backend = "BUILTIN";

    render(<SecretPickerInput value="" onChange={onChangeMock} />);

    fireEvent.click(screen.getByRole("button", { name: /select secret/i }));

    expect(await screen.findByRole("button", { name: /api_key/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create new secret/i })).toBeInTheDocument();
  });
  it("does not expose create-secret UI while Vault backend detection is still loading", async () => {
    queryState.backend = "VAULT";
    queryState.vaultLoading = true;

    render(<SecretPickerInput value="" onChange={onChangeMock} />);

    fireEvent.click(screen.getByRole("button", { name: /select secret/i }));

    expect(screen.queryByRole("button", { name: /create new secret/i })).not.toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
  it("does not expose create-secret UI when the Vault backend probe fails", async () => {
    queryState.backend = "VAULT";
    queryState.vaultError = true;

    render(<SecretPickerInput value="" onChange={onChangeMock} />);

    fireEvent.click(screen.getByRole("button", { name: /select secret/i }));

    expect(screen.queryByRole("button", { name: /create new secret/i })).not.toBeInTheDocument();
  });
});
