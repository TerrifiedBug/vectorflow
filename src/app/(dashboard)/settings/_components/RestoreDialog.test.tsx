// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const state = vi.hoisted(() => ({
  previewData: {
    filename: "imported.dump",
    vfVersion: "1.2.0",
    migrationCount: 1,
    lastMigration: "20250101_init",
    sizeBytes: 1024,
    pgVersion: "16.1",
    startedAt: new Date("2025-01-01T02:00:00Z"),
    tablesPresent: ["Team", "User"],
    warnings: [
      {
        severity: "warning" as const,
        code: "ENCRYPTION_UNKNOWN",
        title: "Encryption key compatibility unknown",
        message:
          "This backup was imported from an external source. Encrypted data (OIDC credentials, git tokens, API keys) will only be readable if both instances share the same encryption key.",
      },
    ],
  },
  restoreResult: {
    success: true as const,
    warnings: [
      "Encryption key mismatch: secrets from the backup were encrypted with a different key. All encrypted credentials (OIDC, git, API keys) are unreadable. Update VF_ENCRYPTION_KEY_V2 or NEXTAUTH_SECRET to match the source instance, then restart.",
    ],
    pgRestoreOutput: "warning: skipped owner",
  },
  invalidateQueries: vi.fn(),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    settings: {
      previewBackup: {
        queryOptions: vi.fn((_input: unknown, options?: Record<string, unknown>) => ({
          queryKey: ["settings.previewBackup"],
          enabled: options?.enabled,
          queryFn: () => state.previewData,
        })),
      },
      restoreBackup: {
        mutationOptions: vi.fn((opts: Record<string, unknown>) => opts),
      },
      listBackups: {
        queryKey: vi.fn(() => ["settings.listBackups"]),
      },
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { enabled?: boolean }) => ({
    data: options.enabled === false ? undefined : state.previewData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMutation: (opts: { onSuccess?: (result: typeof state.restoreResult) => void }) => ({
    mutate: vi.fn(() => opts.onSuccess?.(state.restoreResult)),
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: state.invalidateQueries }),
}));

import { RestoreDialog } from "./RestoreDialog";

afterEach(cleanup);

describe("RestoreDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires acknowledging preview warnings before continuing", () => {
    render(<RestoreDialog open={true} onOpenChange={vi.fn()} filename="imported.dump" />);

    expect(screen.getByText("Encryption key compatibility unknown")).toBeInTheDocument();

    const continueButton = screen.getByRole("button", { name: /continue to confirmation/i });
    expect(continueButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));

    expect(continueButton).toBeEnabled();
  });

  it("shows restore warnings and technical details after a successful restore", () => {
    render(<RestoreDialog open={true} onOpenChange={vi.fn()} filename="imported.dump" />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /continue to confirmation/i }));
    fireEvent.change(screen.getByLabelText(/type restore to confirm/i), {
      target: { value: "RESTORE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /restore database/i }));

    expect(
      screen.getByText(/database restored successfully from backup taken on/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/restore completed with warnings/i)).toBeInTheDocument();
    expect(screen.getByText(/encryption key mismatch/i)).toBeInTheDocument();
    expect(screen.getByText(/technical details/i)).toBeInTheDocument();
    expect(screen.getByText(/warning: skipped owner/i)).toBeInTheDocument();
  });
});
