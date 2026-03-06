"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { Lock, X, AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
}

export function SecretPickerInput({ value, onChange }: SecretPickerInputProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const environmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  const secretsQuery = useQuery(
    trpc.secret.list.queryOptions(
      { environmentId: environmentId! },
      { enabled: !!environmentId && popoverOpen },
    )
  );
  const secrets = secretsQuery.data ?? [];

  const createMutation = useMutation(
    trpc.secret.create.mutationOptions({
      onSuccess: (created) => {
        queryClient.invalidateQueries({ queryKey: trpc.secret.list.queryKey({ environmentId: environmentId! }) });
        onChange(makeSecretRef(created.name));
        setPopoverOpen(false);
        resetCreateForm();
        toast.success(`Secret "${created.name}" created`);
      },
      onError: (err) => toast.error(err.message),
    })
  );

  function resetCreateForm() {
    setShowCreate(false);
    setNewName("");
    setNewValue("");
  }

  function handleCreate() {
    if (!environmentId || !newName.trim() || !newValue.trim()) return;
    createMutation.mutate({
      environmentId,
      name: newName.trim(),
      value: newValue.trim(),
    });
  }

  const secretRef = typeof value === "string" ? parseSecretRef(value) : null;
  const isPlaintextLegacy = !!value && !secretRef;

  // State 1: Secret reference selected — show badge
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
          aria-label="Clear secret reference"
          onClick={() => onChange("")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  // Shared popover content
  const pickerPopover = environmentId ? (
    <Popover open={popoverOpen} onOpenChange={(open) => { setPopoverOpen(open); if (!open) resetCreateForm(); }}>
      <PopoverTrigger asChild>
        {isPlaintextLegacy ? (
          <Button type="button" variant="outline" size="sm">
            <Lock className="h-3.5 w-3.5 mr-2" />
            Select secret to replace
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" className="text-muted-foreground">
            <Lock className="h-3.5 w-3.5 mr-2" />
            Select secret...
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="p-3 pb-2">
          <p className="text-sm font-medium">Select Secret</p>
          <p className="text-xs text-muted-foreground">
            Choose a secret from this environment
          </p>
        </div>
        <div className="max-h-48 overflow-y-auto border-t">
          {secrets.length === 0 && !secretsQuery.isLoading ? (
            <p className="p-3 text-xs text-muted-foreground text-center">
              No secrets yet
            </p>
          ) : secretsQuery.isLoading ? (
            <p className="p-3 text-xs text-muted-foreground text-center">
              Loading...
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
                  resetCreateForm();
                }}
              >
                {secret.name}
              </button>
            ))
          )}
        </div>
        <div className="border-t p-2">
          {showCreate ? (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="MY_SECRET_NAME"
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Value</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="secret value"
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs flex-1"
                  disabled={!newName.trim() || !newValue.trim() || createMutation.isPending}
                  onClick={handleCreate}
                >
                  {createMutation.isPending ? "Creating..." : "Create & Use"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={resetCreateForm}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full h-8 text-xs"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Create new secret
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  ) : null;

  // State 2: Legacy plaintext value — show warning + picker
  if (isPlaintextLegacy) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="destructive" className="flex items-center gap-1.5 px-3 py-1.5">
            <AlertTriangle className="h-3 w-3" />
            <span className="text-xs">Plaintext value — select a secret to replace</span>
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Clear value"
            onClick={() => onChange("")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        {pickerPopover ?? (
          <p className="text-xs text-muted-foreground">
            Select an environment to choose a replacement secret
          </p>
        )}
      </div>
    );
  }

  // State 3: No value — show picker button
  return pickerPopover ?? <p className="text-xs text-muted-foreground">No environment selected</p>;
}
