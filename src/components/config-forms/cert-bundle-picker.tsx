"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, X } from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { makeCertRef, parseCertRef } from "./cert-picker-input";

interface BundleCertificateRef {
  id: string;
  name: string;
  filename: string;
  fileType: string;
}

interface CertificateBundle {
  id: string;
  name: string;
  ca: BundleCertificateRef | null;
  cert: BundleCertificateRef | null;
  key: BundleCertificateRef | null;
}

interface CertBundlePickerInputProps {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}

function expandBundle(bundle: CertificateBundle) {
  return {
    ca_file: bundle.ca ? makeCertRef(bundle.ca.name) : "",
    crt_file: bundle.cert ? makeCertRef(bundle.cert.name) : "",
    key_file: bundle.key ? makeCertRef(bundle.key.name) : "",
  };
}

function currentBundleRefs(value: Record<string, unknown>) {
  const caRef = typeof value.ca_file === "string" ? parseCertRef(value.ca_file) : null;
  const certRef = typeof value.crt_file === "string" ? parseCertRef(value.crt_file) : null;
  const keyRef = typeof value.key_file === "string" ? parseCertRef(value.key_file) : null;
  return { caRef, certRef, keyRef };
}

export function CertBundlePickerInput({ value, onChange }: CertBundlePickerInputProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const trpc = useTRPC();
  const environmentId = useEnvironmentStore((state) => state.selectedEnvironmentId);

  const bundlesQuery = useQuery(
    trpc.certificate.bundleList.queryOptions(
      { environmentId: environmentId! },
      { enabled: Boolean(environmentId) && popoverOpen },
    ),
  );
  const bundles = (bundlesQuery.data ?? []) as CertificateBundle[];

  const { caRef, certRef, keyRef } = currentBundleRefs(value);
  const hasAnySelection = Boolean(caRef || certRef || keyRef);
  const selectedBundle = useMemo(
    () =>
      bundles.find(
        (bundle) =>
          (bundle.ca?.name ?? null) === caRef &&
          (bundle.cert?.name ?? null) === certRef &&
          (bundle.key?.name ?? null) === keyRef,
      ) ?? null,
    [bundles, caRef, certRef, keyRef],
  );

  const applyBundle = (bundle: CertificateBundle) => {
    onChange({ ...value, ...expandBundle(bundle) });
    setPopoverOpen(false);
  };

  const clearBundle = () => {
    onChange({ ...value, ca_file: "", crt_file: "", key_file: "" });
  };

  if (!environmentId) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="font-mono uppercase tracking-[0.04em] text-[10.5px] text-fg-2">
            Certificate Bundle
          </p>
        </div>
        <p className="py-2 text-xs text-muted-foreground">
          Select an environment to choose a certificate bundle.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 rounded-[3px] border border-dashed border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="font-mono uppercase tracking-[0.04em] text-[10.5px] text-fg-2">
            Certificate Bundle
          </p>
          <Badge variant="outline" className="text-[10px]">
            Auto-fill TLS refs
          </Badge>
        </div>
        {selectedBundle ? (
          <Badge variant="secondary" className="font-mono text-[10.5px]">
            {selectedBundle.name}
          </Badge>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start gap-2 font-normal text-muted-foreground"
            >
              <Boxes className="h-3.5 w-3.5" />
              {selectedBundle?.name ?? "Select a certificate bundle..."}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <div className="p-3 pb-2">
              <p className="text-sm font-medium">Select Certificate Bundle</p>
              <p className="text-xs text-muted-foreground">
                Bundles group CA, certificate, and key selections for TLS forms.
              </p>
            </div>
            <div className="max-h-56 overflow-y-auto border-t">
              {bundles.length === 0 ? (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  {bundlesQuery.isLoading ? "Loading..." : "No certificate bundles created"}
                </p>
              ) : (
                bundles.map((bundle) => (
                  <button
                    key={bundle.id}
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                    onClick={() => applyBundle(bundle)}
                  >
                    <span className="font-mono">{bundle.name}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      CA: {bundle.ca?.name ?? "—"} · Cert: {bundle.cert?.name ?? "—"} · Key: {bundle.key?.name ?? "—"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {hasAnySelection ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Clear certificate bundle"
            onClick={clearBundle}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>

      <p className="text-[11px] text-fg-2">
        Selecting a bundle writes individual <span className="font-mono text-fg-1">CERT[name]</span> references into the TLS fields below.
      </p>
    </div>
  );
}
