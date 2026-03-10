"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { VECTOR_CATALOG } from "@/lib/vector/catalog";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SchemaForm } from "@/components/config-forms/schema-form";

import type { VectorComponentDef } from "@/lib/vector/types";

/* ------------------------------------------------------------------ */
/*  Kind badge styling                                                 */
/* ------------------------------------------------------------------ */

const kindVariant: Record<string, string> = {
  source:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  transform:
    "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  sink: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
};

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

type Step = "select" | "configure";

export default function NewSharedComponentPage() {
  const router = useRouter();
  const trpc = useTRPC();
  const selectedEnvironmentId = useEnvironmentStore(
    (s) => s.selectedEnvironmentId,
  );

  const [step, setStep] = useState<Step>("select");
  const [search, setSearch] = useState("");
  const [selectedComponent, setSelectedComponent] =
    useState<VectorComponentDef | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});

  const filteredCatalog = useMemo(() => {
    if (!search) return VECTOR_CATALOG;
    const q = search.toLowerCase();
    return VECTOR_CATALOG.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q) ||
        c.kind.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [search]);

  const createMutation = useMutation(
    trpc.sharedComponent.create.mutationOptions({
      onSuccess: (sc) => {
        toast.success("Shared component created");
        router.push(`/library/shared-components/${sc.id}`);
      },
      onError: (err) => {
        toast.error(err.message);
      },
    }),
  );

  const handleSelectComponent = (comp: VectorComponentDef) => {
    setSelectedComponent(comp);
    setName(comp.displayName);
    setConfig({});
    setStep("configure");
  };

  const handleCreate = () => {
    if (!selectedComponent || !selectedEnvironmentId || !name.trim()) return;
    createMutation.mutate({
      environmentId: selectedEnvironmentId,
      name: name.trim(),
      description: description || undefined,
      componentType: selectedComponent.type,
      kind: selectedComponent.kind.toUpperCase() as "SOURCE" | "TRANSFORM" | "SINK",
      config,
    });
  };

  if (!selectedEnvironmentId) {
    return (
      <div className="space-y-8 p-6">
        <Link
          href="/library/shared-components"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Shared Components
        </Link>
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Select an environment from the header to create a shared component
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Back link */}
      {step === "select" ? (
        <Link
          href="/library/shared-components"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Shared Components
        </Link>
      ) : (
        <button
          onClick={() => setStep("select")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Component Selection
        </button>
      )}

      {step === "select" && (
        <>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">
              New Shared Component
            </h1>
            <p className="text-sm text-muted-foreground">
              Choose a component type to create a reusable shared component.
            </p>
          </div>

          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search components..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Component grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCatalog.map((comp) => (
              <Card
                key={`${comp.kind}-${comp.type}`}
                className="cursor-pointer transition-colors hover:bg-accent/50"
                onClick={() => handleSelectComponent(comp)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm">
                      {comp.displayName}
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={kindVariant[comp.kind] ?? ""}
                    >
                      {comp.kind}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {comp.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredCatalog.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
              <p className="text-muted-foreground">
                No components match your search.
              </p>
            </div>
          )}
        </>
      )}

      {step === "configure" && selectedComponent && (
        <>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">
                New Shared Component
              </h1>
              <Badge
                variant="outline"
                className={kindVariant[selectedComponent.kind] ?? ""}
              >
                {selectedComponent.kind}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Configure your {selectedComponent.displayName} shared component.
            </p>
          </div>

          <div className="max-w-2xl space-y-6">
            {/* Details */}
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Component name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description..."
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Config */}
            <Card>
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
                <CardDescription>
                  Configure the {selectedComponent.displayName} component.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SchemaForm
                  schema={selectedComponent.configSchema as { type?: string; properties?: Record<string, Record<string, unknown>>; required?: string[] }}
                  values={config}
                  onChange={setConfig}
                />
              </CardContent>
            </Card>

            {/* Create button */}
            <div className="flex justify-end">
              <Button
                onClick={handleCreate}
                disabled={!name.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {createMutation.isPending
                  ? "Creating..."
                  : "Create Shared Component"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
