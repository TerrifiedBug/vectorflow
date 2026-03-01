"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { Lock, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const SECRET_REF_PATTERN = /^SECRET\[(.+)]$/;

export function parseSecretRef(value: string): string | null {
  const match = value.match(SECRET_REF_PATTERN);
  return match ? match[1] : null;
}

export function makeSecretRef(name: string): string {
  return `SECRET[${name}]`;
}

interface SecretPickerInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SecretPickerInput({ value, onChange, placeholder }: SecretPickerInputProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const trpc = useTRPC();
  const environmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  const secretsQuery = useQuery(
    trpc.secret.list.queryOptions(
      { environmentId: environmentId! },
      { enabled: !!environmentId && popoverOpen },
    )
  );
  const secrets = secretsQuery.data ?? [];

  const secretRef = typeof value === "string" ? parseSecretRef(value) : null;

  // When a secret reference is active, show a badge instead of the input
  if (secretRef) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="flex items-center gap-1.5 px-3 py-1.5">
          <Lock className="h-3 w-3" />
          <span className="font-mono text-xs">{secretRef}</span>
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Clear secret reference"
          onClick={() => onChange("")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1"
      />
      {environmentId && (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              title="Use a secret"
            >
              <Lock className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-0">
            <div className="p-3 pb-2">
              <p className="text-sm font-medium">Use Secret</p>
              <p className="text-xs text-muted-foreground">
                Select a secret from this environment
              </p>
            </div>
            <div className="max-h-48 overflow-y-auto border-t">
              {secrets.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground text-center">
                  {secretsQuery.isLoading ? "Loading..." : "No secrets available"}
                </p>
              ) : (
                secrets.map((secret) => (
                  <button
                    key={secret.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors font-mono"
                    onClick={() => {
                      onChange(makeSecretRef(secret.name));
                      setPopoverOpen(false);
                    }}
                  >
                    {secret.name}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
