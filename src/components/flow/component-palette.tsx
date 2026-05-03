"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, PackageOpen, Link2 as LinkIcon, Plus } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getVectorCatalog } from "@/lib/vector/catalog";
import type { VectorComponentDef } from "@/lib/vector/types";
import { NODE_KIND_META } from "@/lib/node-kind-colors";
import { getIcon } from "./node-icon";
import { StaggerList, StaggerItem } from "@/components/motion";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useFlowStore } from "@/stores/flow-store";
import { DLP_VRL_SOURCES } from "@/lib/vector/dlp-vrl-sources";

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

interface SharedComponentListItem {
  id: string;
  name: string;
  componentType: string;
  kind: string;
  config: Record<string, unknown>;
  version: number;
  linkedPipelineCount: number;
}

function formatFilterLabel(kind: "all" | VectorComponentDef["kind"]) {
  return kind[0].toUpperCase() + kind.slice(1);
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
      <div className="min-w-0 flex-1">
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
      </div>
      <button
        type="button"
        aria-label={`Add ${def.displayName} to canvas`}
        onClick={() => onAdd(def)}
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
        aria-expanded={open}
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
        aria-expanded={open}
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
  const reactFlowInstance = useReactFlow();
  const addNode = useFlowStore((s) => s.addNode);

  const getCanvasCenterPosition = useCallback(() => {
    const canvas = document.querySelector(".react-flow");
    const rect = canvas?.getBoundingClientRect();
    const screenPosition =
      rect && rect.width > 0 && rect.height > 0
        ? {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          }
        : { x: 0, y: 0 };

    return reactFlowInstance.screenToFlowPosition(screenPosition);
  }, [reactFlowInstance]);

  const addComponentToCanvas = useCallback(
    (componentDef: VectorComponentDef, sharedComponent?: SharedComponentListItem) => {
      addNode(componentDef, getCanvasCenterPosition());

      if (componentDef.type.startsWith("dlp_")) {
        const dlpVrlSource = DLP_VRL_SOURCES[componentDef.type];
        if (dlpVrlSource) {
          const nodes = useFlowStore.getState().nodes;
          const newNode = nodes[nodes.length - 1];
          if (newNode) {
            useFlowStore.getState().updateNodeConfig(newNode.id, {
              ...(newNode.data.config as Record<string, unknown>),
              source: dlpVrlSource,
            });
          }
        }
      }

      if (sharedComponent) {
        const nodes = useFlowStore.getState().nodes;
        const newNode = nodes[nodes.length - 1];
        if (newNode) {
          useFlowStore.getState().patchNodeSharedData(newNode.id, {
            config: sharedComponent.config,
            sharedComponentId: sharedComponent.id,
            sharedComponentVersion: sharedComponent.version,
            sharedComponentName: sharedComponent.name,
            sharedComponentLatestVersion: sharedComponent.version,
          });
        }
      }
    },
    [addNode, getCanvasCenterPosition]
  );

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
      <div className="flex border-b px-3" role="tablist" aria-label="Component palette sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "catalog"}
          className={cn(
            "flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors",
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
            "flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors",
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
            <CollapsibleSection kind="source" items={sources} onAdd={addComponentToCanvas} />
            <CollapsibleSection kind="transform" items={transforms} onAdd={addComponentToCanvas} />
            <CollapsibleSection kind="sink" items={sinks} onAdd={addComponentToCanvas} />

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
                    "rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors",
                    sharedKindFilter === kind
                      ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                  onClick={() => setSharedKindFilter(kind)}
                >
                  {formatFilterLabel(kind)}
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
                const Icon = getIcon(
                  getVectorCatalog().find((d) => d.type === sc.componentType)?.icon
                );
                const componentDef = getVectorCatalog().find(
                  (d) => d.type === sc.componentType && d.kind === kindKey
                );
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
                    <div className="min-w-0 flex-1">
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
                    </div>
                    <button
                      type="button"
                      aria-label={`Add ${sc.name} to canvas`}
                      disabled={!componentDef}
                      onClick={() => componentDef && addComponentToCanvas(componentDef, sc)}
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
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
