"use client";

import { memo, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, PackageOpen, Link2 as LinkIcon, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { findComponentDef, getVectorCatalog } from "@/lib/vector/catalog";
import type { VectorComponentDef } from "@/lib/vector/types";
import { NODE_KIND_META } from "@/lib/node-kind-colors";
import { getIcon } from "./node-icon";
import { StaggerList, StaggerItem } from "@/components/motion";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useFlowStore } from "@/stores/flow-store";

const kindMeta: Record<
  VectorComponentDef["kind"],
  { label: string; borderClass: string; bgClass: string }
> = {
  source: {
    label: NODE_KIND_META.source.pluralLabel,
    borderClass: NODE_KIND_META.source.borderClass,
    bgClass: NODE_KIND_META.source.bgClass,
  },
  transform: {
    label: NODE_KIND_META.transform.pluralLabel,
    borderClass: NODE_KIND_META.transform.borderClass,
    bgClass: NODE_KIND_META.transform.bgClass,
  },
  sink: {
    label: NODE_KIND_META.sink.pluralLabel,
    borderClass: NODE_KIND_META.sink.borderClass,
    bgClass: NODE_KIND_META.sink.bgClass,
  },
};

function keyboardAddPosition(nodeCount: number) {
  const offset = nodeCount * 32;
  return { x: 120 + offset, y: 120 + offset };
}

const DraggableItem = memo(function DraggableItem({
  def,
  onAdd,
}: {
  def: VectorComponentDef;
  onAdd: (def: VectorComponentDef) => void;
}) {
  const Icon = useMemo(() => getIcon(def.icon), [def.icon]);
  const meta = kindMeta[def.kind];

  function handleDragStart(event: React.DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData(
      "application/vectorflow-component",
      `${def.kind}:${def.type}`
    );
    event.dataTransfer.effectAllowed = "move";
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onAdd(def);
    }
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={cn(
        "flex cursor-grab items-start gap-3 rounded-md border border-l-[3px] bg-card px-3 py-2.5 transition-colors hover:bg-accent active:cursor-grabbing",
        meta.borderClass
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
          meta.bgClass,
          "text-white"
        )}
      >
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon className="h-4 w-4" />
      </div>
      <button
        type="button"
        onClick={() => onAdd(def)}
        onKeyDown={handleKeyDown}
        aria-label={`${def.displayName} ${def.kind} component. Press Enter or Space to add to canvas.`}
        className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {def.displayName}
          </span>
          <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-xs">
            {def.category}
          </Badge>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {def.description}
        </p>
      </button>
      <button
        type="button"
        onClick={() => onAdd(def)}
        tabIndex={-1}
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
});

const CategoryGroup = memo(function CategoryGroup({
  category,
  items,
  onAdd,
}: {
  category: string;
  items: VectorComponentDef[];
  onAdd: (def: VectorComponentDef) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-1 px-1 py-1 text-[11px] font-medium text-muted-foreground/70 transition-colors hover:text-muted-foreground"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {category}
        <span className="ml-auto font-normal tabular-nums text-xs">
          {items.length}
        </span>
      </button>
      {open && (
        <StaggerList className="space-y-1.5 pb-1 pl-1">
          {items.map((def) => (
            <StaggerItem key={def.type}>
              <DraggableItem def={def} onAdd={onAdd} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </div>
  );
});

function CollapsibleSection({
  kind,
  items,
  onAdd,
}: {
  kind: VectorComponentDef["kind"];
  items: VectorComponentDef[];
  onAdd: (def: VectorComponentDef) => void;
}) {
  const [open, setOpen] = useState(true);
  const meta = kindMeta[kind];

  const grouped = useMemo(() => {
    const map = new Map<string, VectorComponentDef[]>();
    for (const def of items) {
      const group = map.get(def.category) ?? [];
      group.push(def);
      map.set(def.category, group);
    }
    return Array.from(map.entries());
  }, [items]);

  if (items.length === 0) return null;

  const needsSubGroups = grouped.length > 1 && items.length > 8;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-1.5 px-1 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        {meta.label}
        <span className="ml-auto font-normal tabular-nums">{items.length}</span>
      </button>
      {open && (
        <div className="space-y-1.5 pb-3">
          {needsSubGroups
            ? grouped.map(([category, defs]) => (
                <CategoryGroup
                  key={category}
                  category={category}
                  items={defs}
                  onAdd={onAdd}
                />
              ))
            : (
              <StaggerList>
                {items.map((def) => (
                  <StaggerItem key={def.type}>
                    <DraggableItem def={def} onAdd={onAdd} />
                  </StaggerItem>
                ))}
              </StaggerList>
            )}
        </div>
      )}
    </div>
  );
}

export function ComponentPalette() {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"catalog" | "shared">("catalog");
  const [sharedKindFilter, setSharedKindFilter] = useState<"all" | "source" | "transform" | "sink">("all");
  const trpc = useTRPC();
  const { selectedEnvironmentId } = useEnvironmentStore();
  const addNode = useFlowStore((s) => s.addNode);
  const patchNodeSharedData = useFlowStore((s) => s.patchNodeSharedData);
  const nodeCount = useFlowStore((s) => s.nodes.length);

  const sharedComponentsQuery = useQuery(
    trpc.sharedComponent.list.queryOptions(
      { environmentId: selectedEnvironmentId! },
      { enabled: !!selectedEnvironmentId }
    )
  );
  const filtered = useMemo(() => {
    if (!search.trim()) return getVectorCatalog();

    const term = search.toLowerCase().trim();
    return getVectorCatalog().filter(
      (def) =>
        def.displayName.toLowerCase().includes(term) ||
        def.type.toLowerCase().includes(term) ||
        def.description.toLowerCase().includes(term) ||
        def.category.toLowerCase().includes(term)
    );
  }, [search]);

  const filteredShared = useMemo(() => {
    let items = sharedComponentsQuery.data ?? [];
    if (sharedKindFilter !== "all") {
      items = items.filter((sc) => sc.kind.toLowerCase() === sharedKindFilter);
    }
    if (!search.trim()) return items;
    const term = search.toLowerCase().trim();
    return items.filter(
      (sc) =>
        sc.name.toLowerCase().includes(term) ||
        sc.componentType.toLowerCase().includes(term)
    );
  }, [search, sharedComponentsQuery.data, sharedKindFilter]);

  const sources = useMemo(
    () => filtered.filter((d) => d.kind === "source"),
    [filtered]
  );
  const transforms = useMemo(
    () => filtered.filter((d) => d.kind === "transform"),
    [filtered]
  );
  const sinks = useMemo(
    () => filtered.filter((d) => d.kind === "sink"),
    [filtered]
  );

  function handleAdd(def: VectorComponentDef) {
    addNode(def, keyboardAddPosition(nodeCount));
  }

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col overflow-hidden border-r bg-background">
      {/* Search */}
      <div className="border-b p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search components..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b px-3" role="tablist" aria-label="Component palette source">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "catalog"}
          className={cn(
            "flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            activeTab === "catalog"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab("catalog")}
        >
          Catalog
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "shared"}
          className={cn(
            "flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            activeTab === "shared"
              ? "border-purple-400 text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab("shared")}
        >
          <span className="flex items-center justify-center gap-1.5">
            <LinkIcon className="h-3 w-3" />
            Shared
          </span>
        </button>
      </div>

      {/* Component list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "catalog" && (
          <div className="space-y-1 p-3">
            <CollapsibleSection kind="source" items={sources} onAdd={handleAdd} />
            <CollapsibleSection kind="transform" items={transforms} onAdd={handleAdd} />
            <CollapsibleSection kind="sink" items={sinks} onAdd={handleAdd} />

            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center p-8">
                <PackageOpen className="h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">
                  No components match your search.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "shared" && (
          <div className="space-y-1.5 p-3">
            <div className="flex gap-1 pb-1">
              {(["all", "source", "transform", "sink"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={sharedKindFilter === kind}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    sharedKindFilter === kind
                      ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                  onClick={() => setSharedKindFilter(kind)}
                >
                  {kind}
                </button>
              ))}
            </div>
            {filteredShared.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8">
                <PackageOpen className="h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-center text-sm text-muted-foreground">
                  {search.trim()
                    ? "No shared components match your search."
                    : "No shared components in this environment."}
                </p>
              </div>
            ) : (
              filteredShared.map((sc) => {
                const kindKey = sc.kind.toLowerCase() as VectorComponentDef["kind"];
                const meta = kindMeta[kindKey] ?? kindMeta.transform;
                const componentDef = findComponentDef(sc.componentType, kindKey);
                const Icon = getIcon(componentDef?.icon);
                const addSharedComponent = () => {
                  if (!componentDef) return;
                  addNode(componentDef, keyboardAddPosition(nodeCount));
                  const newNode = useFlowStore.getState().nodes.at(-1);
                  if (newNode) {
                    patchNodeSharedData(newNode.id, {
                      config: sc.config as Record<string, unknown>,
                      sharedComponentId: sc.id,
                      sharedComponentVersion: sc.version,
                      sharedComponentName: sc.name,
                      sharedComponentLatestVersion: sc.version,
                    });
                  }
                };
                const onSharedKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    addSharedComponent();
                  }
                };
                return (
                  <div
                    key={sc.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "application/vectorflow-component",
                        `${sc.kind.toLowerCase()}:${sc.componentType}`
                      );
                      e.dataTransfer.setData(
                        "application/vectorflow-shared-component-id",
                        sc.id
                      );
                      e.dataTransfer.setData(
                        "application/vectorflow-shared-component-data",
                        JSON.stringify(sc)
                      );
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className={cn(
                      "flex cursor-grab items-start gap-3 rounded-md border border-l-[3px] bg-card px-3 py-2.5 transition-colors hover:bg-accent active:cursor-grabbing",
                      meta.borderClass
                    )}
                  >
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-purple-500/20 text-purple-400">
                      <Icon className="h-4 w-4" />
                    </div>
                    <button
                      type="button"
                      onClick={addSharedComponent}
                      onKeyDown={onSharedKeyDown}
                      disabled={!componentDef}
                      aria-label={`${sc.name} ${kindKey} shared component. Press Enter or Space to add to canvas.`}
                      className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">
                          {sc.name}
                        </span>
                        <LinkIcon className="h-3 w-3 shrink-0 text-purple-400" />
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="truncate text-xs text-muted-foreground">
                          {sc.componentType}
                        </span>
                        {sc.linkedPipelineCount > 0 && (
                          <Badge
                            variant="outline"
                            className="shrink-0 px-1 py-0 text-[10px]"
                          >
                            {sc.linkedPipelineCount} pipeline{sc.linkedPipelineCount !== 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={addSharedComponent}
                      disabled={!componentDef}
                      tabIndex={-1}
                      aria-hidden="true"
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
