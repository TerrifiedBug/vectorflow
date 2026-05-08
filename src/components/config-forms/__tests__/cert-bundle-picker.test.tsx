// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const queryState = vi.hoisted(() => ({
  bundles: [
    {
      id: "bundle-1",
      name: "mtls-prod",
      environmentId: "env-1",
      caId: "ca-1",
      certId: "cert-1",
      keyId: "key-1",
      createdAt: new Date("2026-05-01T00:00:00Z").toISOString(),
      updatedAt: new Date("2026-05-02T00:00:00Z").toISOString(),
      ca: { id: "ca-1", name: "root-ca", filename: "root.pem", fileType: "ca" },
      cert: { id: "cert-1", name: "client-cert", filename: "client.pem", fileType: "cert" },
      key: { id: "key-1", name: "client-key", filename: "client.key", fileType: "key" },
    },
    {
      id: "bundle-2",
      name: "shared-ca-only",
      environmentId: "env-1",
      caId: "ca-2",
      certId: null,
      keyId: null,
      createdAt: new Date("2026-05-01T00:00:00Z").toISOString(),
      updatedAt: new Date("2026-05-02T00:00:00Z").toISOString(),
      ca: { id: "ca-2", name: "shared-ca", filename: "shared-ca.pem", fileType: "ca" },
      cert: null,
      key: null,
    },
  ],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { __name?: string }) => {
    if (options.__name === "certificate.bundleList") {
      return { data: queryState.bundles, isLoading: false };
    }
    if (options.__name === "certificate.list") {
      return { data: [], isLoading: false };
    }
    return { data: undefined, isLoading: false };
  },
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    certificate: {
      bundleList: {
        queryOptions: (input: { environmentId: string }, options?: object) => ({
          __name: "certificate.bundleList",
          input,
          options,
        }),
      },
      list: {
        queryOptions: (input: { environmentId: string }, options?: object) => ({
          __name: "certificate.list",
          input,
          options,
        }),
      },
    },
  }),
}));

vi.mock("@/stores/environment-store", () => ({
  useEnvironmentStore: (selector: (state: { selectedEnvironmentId: string }) => unknown) =>
    selector({ selectedEnvironmentId: "env-1" }),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { CertBundlePickerInput } from "../cert-bundle-picker";
import { FieldRenderer } from "../field-renderer";

afterEach(cleanup);

describe("CertBundlePickerInput", () => {
  it("expands a selected bundle into CERT refs", () => {
    const onChange = vi.fn();

    render(<CertBundlePickerInput value={{}} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /mtls-prod/i }));

    expect(onChange).toHaveBeenCalledWith({
      ca_file: "CERT[root-ca]",
      crt_file: "CERT[client-cert]",
      key_file: "CERT[client-key]",
    });
  });

  it("clears stale cert refs when the selected bundle omits them", () => {
    const onChange = vi.fn();

    render(
      <CertBundlePickerInput
        value={{
          ca_file: "CERT[old-ca]",
          crt_file: "CERT[old-cert]",
          key_file: "CERT[old-key]",
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /shared-ca-only/i }));

    expect(onChange).toHaveBeenCalledWith({
      ca_file: "CERT[shared-ca]",
      crt_file: "",
      key_file: "",
    });
  });

  it("renders inside TLS object sections and preserves unrelated TLS fields", () => {
    const onChange = vi.fn();

    render(
      <FieldRenderer
        name="tls"
        schema={{
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            ca_file: { type: "string" },
            crt_file: { type: "string" },
            key_file: { type: "string" },
            server_name: { type: "string" },
          },
        }}
        value={{ enabled: true, server_name: "api.internal" }}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Certificate Bundle")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /mtls-prod/i })[0]!);

    expect(onChange).toHaveBeenCalledWith({
      enabled: true,
      server_name: "api.internal",
      ca_file: "CERT[root-ca]",
      crt_file: "CERT[client-cert]",
      key_file: "CERT[client-key]",
    });
  });
});
