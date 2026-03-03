"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { FileKey, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const CERT_REF_PATTERN = /^CERT\[(.+)]$/;

export function parseCertRef(value: string): string | null {
  const match = value.match(CERT_REF_PATTERN);
  return match ? match[1] : null;
}

export function makeCertRef(name: string): string {
  return `CERT[${name}]`;
}

/** Maps TLS field names to the certificate fileType they should filter by */
const FIELD_TO_FILE_TYPE: Record<string, string> = {
  ca_file: "ca",
  ca_path: "ca",
  crt_file: "cert",
  cert_file: "cert",
  key_file: "key",
};

interface CertPickerInputProps {
  fieldName: string;
  value: string;
  onChange: (value: string) => void;
}

export function CertPickerInput({ fieldName, value, onChange }: CertPickerInputProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const trpc = useTRPC();
  const environmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  const filterType = FIELD_TO_FILE_TYPE[fieldName];

  const certsQuery = useQuery(
    trpc.certificate.list.queryOptions(
      { environmentId: environmentId! },
      { enabled: !!environmentId && popoverOpen },
    )
  );

  const certs = (certsQuery.data ?? []).filter(
    (c) => !filterType || c.fileType === filterType
  );

  const certRef = typeof value === "string" ? parseCertRef(value) : null;

  if (certRef) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="flex items-center gap-1.5 px-3 py-1.5">
          <FileKey className="h-3 w-3" />
          <span className="font-mono text-xs">{certRef}</span>
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Clear certificate reference"
          onClick={() => onChange("")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  if (!environmentId) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        Select an environment to choose a certificate.
      </p>
    );
  }

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 font-normal text-muted-foreground"
        >
          <FileKey className="h-3.5 w-3.5" />
          Select a certificate...
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="p-3 pb-2">
          <p className="text-sm font-medium">Select Certificate</p>
          <p className="text-xs text-muted-foreground">
            Upload certificates in Environment &rarr; Certificates
          </p>
        </div>
        <div className="max-h-48 overflow-y-auto border-t">
          {certs.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground text-center">
              {certsQuery.isLoading ? "Loading..." : "No matching certificates uploaded"}
            </p>
          ) : (
            certs.map((cert) => (
              <button
                key={cert.id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                onClick={() => {
                  onChange(makeCertRef(cert.name));
                  setPopoverOpen(false);
                }}
              >
                <span className="font-mono">{cert.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  ({cert.filename})
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Check if a field name is a TLS certificate path field */
export function isCertFileField(name: string): boolean {
  return name in FIELD_TO_FILE_TYPE;
}
