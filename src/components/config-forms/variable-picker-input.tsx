"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Variable, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useFlowStore } from "@/stores/flow-store";
import { useTRPC } from "@/trpc/client";

const VAR_REF_PATTERN = /^VAR\[(.+)]$/;
const VARIABLE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

interface VariablePickerInputProps {
  value: string;
  onChange: (value: string) => void;
  environmentId: string;
  className?: string;
}

export function VariablePickerInput({
  value,
  onChange,
  environmentId,
  className,
}: VariablePickerInputProps) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");

  const pipelineVariables = useFlowStore((s) => s.pipelineVariables);
  const updatePipelineVariable = useFlowStore((s) => s.updatePipelineVariable);

  const varMatch = value.match(VAR_REF_PATTERN);
  const varName = varMatch?.[1];

  const trpc = useTRPC();
  const envVarsQuery = useQuery(
    trpc.variable.list.queryOptions(
      { environmentId },
      { enabled: !!environmentId && (open || !!varName) },
    ),
  );
  const envVars = envVarsQuery.data ?? [];

  const previewValue = varName
    ? pipelineVariables[varName] ?? envVars.find((v) => v.name === varName)?.value ?? "(unresolved)"
    : null;
  const pipelineEntries = Object.entries(pipelineVariables);

  const handleSelect = (name: string) => {
    onChange(`VAR[${name}]`);
    setOpen(false);
  };

  const handleAddInline = () => {
    const trimmed = newName.trim();
    if (!VARIABLE_NAME_PATTERN.test(trimmed)) return;
    updatePipelineVariable(trimmed, newValue);
    onChange(`VAR[${trimmed}]`);
    setNewName("");
    setNewValue("");
    setOpen(false);
  };

  if (varName) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <Badge variant="secondary" className="max-w-full gap-1 text-xs font-mono normal-case tracking-normal">
          VAR[{varName}]
          <span className="min-w-0 truncate text-muted-foreground">= {previewValue}</span>
        </Badge>
        <button
          type="button"
          onClick={() => onChange("")}
          className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear variable reference"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7 shrink-0", className)}
          title="Insert variable reference"
          aria-label="Insert variable reference"
        >
          <Variable className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="max-h-64 overflow-y-auto">
          <div className="border-b px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">Pipeline Variables</p>
          </div>
          {pipelineEntries.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No pipeline variables defined</div>
          ) : (
            pipelineEntries.map(([name, val]) => (
              <button
                key={`p-${name}`}
                type="button"
                className="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => handleSelect(name)}
              >
                <code className="font-medium">{name}</code>
                <span className="ml-2 truncate text-muted-foreground">{val}</span>
              </button>
            ))
          )}

          <div className="border-b border-t px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">Environment Variables</p>
          </div>
          {envVarsQuery.isLoading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Loading variables...</div>
          ) : envVars.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No environment variables defined</div>
          ) : (
            envVars.map((v) => (
              <button
                key={`e-${v.id}`}
                type="button"
                className="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => handleSelect(v.name)}
              >
                <code className="font-medium">{v.name}</code>
                <span className="ml-2 truncate text-muted-foreground">{v.value}</span>
              </button>
            ))
          )}

          <div className="border-t px-3 py-2">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Quick Add Pipeline Variable</p>
            <div className="flex gap-1.5">
              <Input
                placeholder="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-7 text-xs"
              />
              <Input
                placeholder="value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="h-7 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2"
                onClick={handleAddInline}
                disabled={!newName.trim()}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
