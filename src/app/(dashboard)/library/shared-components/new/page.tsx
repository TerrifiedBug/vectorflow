"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { VECTOR_CATALOG } from "@/lib/vector/catalog";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Loader2, Plus, Search } from "lucide-react";

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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SchemaForm } from "@/components/config-forms/schema-form";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";

import type { VectorComponentDef } from "@/lib/vector/types";

/* ------------------------------------------------------------------ */
/*  Kind styling                                                       */
/* ------------------------------------------------------------------ */

const kindVariant: Record<string, string> = {
  source:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  transform:
    "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  sink: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
};

const kindSectionConfig: Record<string, { label: string; accent: string }> = {
  source: {
    label: "Sources",
    accent: "text-emerald-600 dark:text-emerald-400",
  },
  transform: {
    label: "Transforms",
    accent: "text-sky-600 dark:text-sky-400",
  },
  sink: {
    label: "Sinks",
    accent: "text-orange-600 dark:text-orange-400",
  },
};

const KIND_ORDER = ["source", "transform", "sink"] as const;

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

  const groupedCatalog = useMemo(
    () =>
      KIND_ORDER.map((kind) => ({
        kind,
        ...kindSectionConfig[kind],
        items: filteredCatalog.filter((c) => c.kind === kind),
      })),
    [filteredCatalog],
  );

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
        <EmptyState title="Select an environment from the header to create a shared component" className="p-4 text-sm" />
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

          {/* Component sections by kind */}
          {filteredCatalog.length === 0 ? (
            <EmptyState title="No components match your search." />
          ) : (
            <div className="space-y-3">
              {groupedCatalog.map((group) => {
                if (group.items.length === 0) return null;
                return (
                  <CatalogKindSection
                    key={group.kind}
                    label={group.label}
                    accent={group.accent}
                    badgeClass={kindVariant[group.kind] ?? ""}
                    count={group.items.length}
                    items={group.items}
                    onSelect={handleSelectComponent}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {step === "configure" && selectedComponent && (
        <>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
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

/* ------------------------------------------------------------------ */
/*  Catalog Kind Section (collapsible)                                 */
/* ------------------------------------------------------------------ */

function CatalogKindSection({
  label,
  accent,
  badgeClass,
  count,
  items,
  onSelect,
}: {
  label: string;
  accent: string;
  badgeClass: string;
  count: number;
  items: VectorComponentDef[];
  onSelect: (comp: VectorComponentDef) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            !open && "-rotate-90",
          )}
        />
        <span className={cn("text-sm font-semibold", accent)}>{label}</span>
        <Badge variant="secondary" className="ml-auto text-xs">
          {count}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((comp) => (
            <Card
              key={`${comp.kind}-${comp.type}`}
              className="cursor-pointer transition-colors hover:bg-accent/50"
              onClick={() => onSelect(comp)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm">
                    {comp.displayName}
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className={badgeClass}
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
      </CollapsibleContent>
    </Collapsible>
  );
}
