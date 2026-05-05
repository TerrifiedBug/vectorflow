"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import { VFIcon, type VFIconName } from "@/components/ui/vf-icon";
import { cn } from "@/lib/utils";
import { getVectorCatalog } from "@/lib/vector/catalog";
import type { VectorComponentDef } from "@/lib/vector/types";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useFlowStore } from "@/stores/flow-store";
import { DLP_VRL_SOURCES } from "@/lib/vector/dlp-vrl-sources";

type Kind = VectorComponentDef["kind"];

interface SharedComponentListItem {
  id: string;
  name: string;
  componentType: string;
  kind: string;
  config: Record<string, unknown>;
  version: number;
  linkedPipelineCount: number;
}

interface SectionMeta {
  label: string;
  tileVar: string;
}

const SECTION_META: Record<Kind, SectionMeta> = {
  source: { label: "Sources", tileVar: "var(--node-source)" },
  transform: { label: "Transforms", tileVar: "var(--node-transform)" },
  sink: { label: "Sinks", tileVar: "var(--node-sink)" },
};

const SECTION_ORDER: Kind[] = ["source", "transform", "sink"];

function tileIconName(kind: Kind): VFIconName {
  if (kind === "source") return "database";
  if (kind === "transform") return "split";
  return "box";
}

function formatFilterLabel(kind: "all" | Kind) {
  return kind[0].toUpperCase() + kind.slice(1);
}

interface DraggableItemProps {
  def: VectorComponentDef;
  onAdd: (def: VectorComponentDef) => void;
}

const DraggableItem = memo(function DraggableItem({
  def,
  onAdd,
}: DraggableItemProps) {
  const tileVar = SECTION_META[def.kind].tileVar;

  function handleDragStart(event: React.DragEvent<HTMLButtonElement>) {
    event.dataTransfer.setData(
      "application/vectorflow-component",
      `${def.kind}:${def.type}`,
    );
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <button
      type="button"
      aria-label={`Add ${def.displayName} to canvas`}
      draggable
      onDragStart={handleDragStart}
      onClick={() => onAdd(def)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAdd(def);
        }
      }}
      className={cn(
        "group flex w-full cursor-grab items-start gap-[9px] rounded-[3px]",
        "border border-line bg-bg-2 px-[9px] py-[7px] text-left",
        "transition-colors hover:border-line-2 hover:bg-bg-3",
        "active:cursor-grabbing",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-line",
      )}
    >
      <span
        aria-hidden="true"
        className="mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[4px] border text-fg"
        style={{
          backgroundColor: `color-mix(in srgb, ${tileVar} 13%, transparent)`,
          borderColor: `color-mix(in srgb, ${tileVar} 33%, transparent)`,
          color: tileVar,
        }}
      >
        <VFIcon name={tileIconName(def.kind)} size={12} strokeWidth={1.6} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[5px]">
          <span className="truncate text-[12px] font-medium text-fg">
            {def.displayName}
          </span>
          <span className="shrink-0 font-mono uppercase text-[9px] tracking-[0.04em] text-fg-2">
            {def.category}
          </span>
        </div>
        <div className="mt-[2px] line-clamp-2 text-[10.5px] leading-[1.35] text-fg-2">
          {def.description}
        </div>
      </div>
    </button>
  );
});

interface SectionProps {
  kind: Kind;
  items: VectorComponentDef[];
  onAdd: (def: VectorComponentDef) => void;
}

function CollapsibleSection({ kind, items, onAdd }: SectionProps) {
  const [open, setOpen] = useState(true);
  const meta = SECTION_META[kind];

  if (items.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-[6px] px-[14px] pt-2 pb-1",
          "font-mono uppercase text-[9px] tracking-[0.08em] text-fg-2",
          "transition-colors hover:text-fg",
        )}
      >
        <VFIcon
          name={open ? "chevron-down" : "chevron-right"}
          size={10}
          strokeWidth={1.6}
        />
        <span>{meta.label}</span>
        <span className="ml-auto tabular-nums text-fg-2">{items.length}</span>
      </button>
      {open && (
        <div className="space-y-[3px] px-2 pb-1">
          {items.map((def) => (
            <DraggableItem key={`${def.kind}:${def.type}`} def={def} onAdd={onAdd} />
          ))}
        </div>
      )}
    </div>
  );
}

interface SharedItemProps {
  sc: SharedComponentListItem;
  componentDef: VectorComponentDef | undefined;
  onAdd: (def: VectorComponentDef, sc: SharedComponentListItem) => void;
}

function SharedItem({ sc, componentDef, onAdd }: SharedItemProps) {
  const kindKey = (sc.kind.toLowerCase() as Kind) ?? "transform";
  const tileVar = SECTION_META[kindKey]?.tileVar ?? SECTION_META.transform.tileVar;
  const canAdd = !!componentDef;

  return (
    <button
      type="button"
      aria-label={`Add ${sc.name} to canvas`}
      disabled={!canAdd}
      draggable={canAdd}
      onDragStart={(e) => {
        if (!canAdd) return;
        e.dataTransfer.setData(
          "application/vectorflow-component",
          `${kindKey}:${sc.componentType}`,
        );
        e.dataTransfer.setData(
          "application/vectorflow-shared-component-id",
          sc.id,
        );
        e.dataTransfer.setData(
          "application/vectorflow-shared-component-data",
          JSON.stringify(sc),
        );
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => componentDef && onAdd(componentDef, sc)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (componentDef) onAdd(componentDef, sc);
        }
      }}
      className={cn(
        "flex w-full cursor-grab items-start gap-[9px] rounded-[3px]",
        "border border-line bg-bg-2 px-[9px] py-[7px] text-left",
        "transition-colors hover:border-line-2 hover:bg-bg-3",
        "active:cursor-grabbing",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-line",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span
        aria-hidden="true"
        className="mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[4px] border"
        style={{
          backgroundColor: `color-mix(in srgb, ${tileVar} 13%, transparent)`,
          borderColor: `color-mix(in srgb, ${tileVar} 33%, transparent)`,
          color: tileVar,
        }}
      >
        <VFIcon name={tileIconName(kindKey)} size={12} strokeWidth={1.6} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[5px]">
          <span className="truncate text-[12px] font-medium text-fg">
            {sc.name}
          </span>
          <VFIcon name="git-branch" size={10} className="shrink-0 text-accent-brand" />
        </div>
        <div className="mt-[2px] flex items-center gap-[6px]">
          <span className="truncate font-mono uppercase text-[9px] tracking-[0.04em] text-fg-2">
            {sc.componentType}
          </span>
          {sc.linkedPipelineCount > 0 && (
            <span className="shrink-0 font-mono text-[9px] text-fg-2">
              · {sc.linkedPipelineCount} pipeline
              {sc.linkedPipelineCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function ComponentPalette() {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"catalog" | "shared">("catalog");
  const [sharedKindFilter, setSharedKindFilter] = useState<"all" | Kind>("all");

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
    (
      componentDef: VectorComponentDef,
      sharedComponent?: SharedComponentListItem,
    ) => {
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
    [addNode, getCanvasCenterPosition],
  );

  const sharedComponentsQuery = useQuery(
    trpc.sharedComponent.list.queryOptions(
      { environmentId: selectedEnvironmentId! },
      { enabled: !!selectedEnvironmentId },
    ),
  );

  const filtered = useMemo(() => {
    const catalog = getVectorCatalog();
    if (!search.trim()) return catalog;

    const term = search.toLowerCase().trim();
    return catalog.filter(
      (def) =>
        def.displayName.toLowerCase().includes(term) ||
        def.type.toLowerCase().includes(term) ||
        def.description.toLowerCase().includes(term) ||
        def.category.toLowerCase().includes(term),
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
        sc.componentType.toLowerCase().includes(term),
    );
  }, [search, sharedComponentsQuery.data, sharedKindFilter]);

  const sectioned = useMemo(() => {
    return SECTION_ORDER.map((kind) => ({
      kind,
      items: filtered.filter((d) => d.kind === kind),
    }));
  }, [filtered]);

  const totalCount = useMemo(() => getVectorCatalog().length, []);

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col overflow-hidden border-r border-line bg-bg-1">
      {/* Search */}
      <div className="border-b border-line p-3">
        <div className="flex h-7 items-center gap-[7px] rounded-[3px] border border-line-2 bg-bg-2 px-[9px]">
          <VFIcon name="search" size={12} className="text-fg-2" />
          <input
            type="text"
            placeholder="Search components..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border-none bg-transparent text-[11px] text-fg outline-none placeholder:text-fg-2"
            aria-label="Search components"
          />
          <span className="font-mono text-[10px] text-fg-2 tabular-nums">
            {totalCount}
          </span>
        </div>
      </div>

      {/* Tab switcher */}
      <div
        className="flex border-b border-line"
        role="tablist"
        aria-label="Component palette sections"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "catalog"}
          className={cn(
            "flex-1 border-b-2 px-2 py-2 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors",
            activeTab === "catalog"
              ? "border-accent-line text-fg"
              : "border-transparent text-fg-2 hover:text-fg",
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
            "flex-1 border-b-2 px-2 py-2 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors",
            activeTab === "shared"
              ? "border-accent-line text-fg"
              : "border-transparent text-fg-2 hover:text-fg",
          )}
          onClick={() => setActiveTab("shared")}
        >
          <span className="flex items-center justify-center gap-[5px]">
            <VFIcon name="git-branch" size={11} />
            Shared
          </span>
        </button>
      </div>

      {/* Component list */}
      <div className="min-h-0 flex-1 overflow-y-auto py-[6px]">
        {activeTab === "catalog" && (
          <>
            {sectioned.map(({ kind, items }) => (
              <CollapsibleSection
                key={kind}
                kind={kind}
                items={items}
                onAdd={addComponentToCanvas}
              />
            ))}
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
                <VFIcon name="search" size={20} className="text-fg-2 opacity-50" />
                <p className="mt-2 text-[11px] text-fg-2">
                  No components match your search.
                </p>
              </div>
            )}
          </>
        )}

        {activeTab === "shared" && (
          <div className="px-2">
            <div
              className="flex gap-1 px-[6px] pb-[6px] pt-1"
              role="group"
              aria-label="Shared component kind filters"
            >
              {(["all", "source", "transform", "sink"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={sharedKindFilter === kind}
                  className={cn(
                    "rounded-[3px] border px-[7px] py-[3px] font-mono text-[9px] uppercase tracking-[0.06em] transition-colors",
                    sharedKindFilter === kind
                      ? "border-accent-line bg-accent-soft text-fg"
                      : "border-transparent text-fg-2 hover:bg-bg-2 hover:text-fg",
                  )}
                  onClick={() => setSharedKindFilter(kind)}
                >
                  {formatFilterLabel(kind)}
                </button>
              ))}
            </div>
            {filteredShared.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
                <VFIcon
                  name="git-branch"
                  size={20}
                  className="text-fg-2 opacity-50"
                />
                <p className="mt-2 text-[11px] text-fg-2">
                  {search.trim()
                    ? "No shared components match your search."
                    : "No shared components in this environment."}
                </p>
              </div>
            ) : (
              <div className="space-y-[3px] pb-1">
                {filteredShared.map((sc) => {
                  const kindKey = sc.kind.toLowerCase() as Kind;
                  const componentDef = getVectorCatalog().find(
                    (d) => d.type === sc.componentType && d.kind === kindKey,
                  );
                  return (
                    <SharedItem
                      key={sc.id}
                      sc={sc}
                      componentDef={componentDef}
                      onAdd={addComponentToCanvas}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
