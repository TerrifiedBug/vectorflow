"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, PackageOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { VECTOR_CATALOG } from "@/lib/vector/catalog";
import type { VectorComponentDef } from "@/lib/vector/types";
import { getIcon } from "./node-icon";

const kindMeta: Record<
  VectorComponentDef["kind"],
  { label: string; borderClass: string; bgClass: string }
> = {
  source: {
    label: "Sources",
    borderClass: "border-l-node-source",
    bgClass: "bg-node-source",
  },
  transform: {
    label: "Transforms",
    borderClass: "border-l-node-transform",
    bgClass: "bg-node-transform",
  },
  sink: {
    label: "Sinks",
    borderClass: "border-l-node-sink",
    bgClass: "bg-node-sink",
  },
};

function DraggableItem({ def }: { def: VectorComponentDef }) {
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
    </div>
  );
}

function CategoryGroup({
  category,
  items,
}: {
  category: string;
  items: VectorComponentDef[];
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
        <div className="space-y-1.5 pb-1 pl-1">
          {items.map((def) => (
            <DraggableItem key={def.type} def={def} />
          ))}
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({
  kind,
  items,
}: {
  kind: VectorComponentDef["kind"];
  items: VectorComponentDef[];
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
                />
              ))
            : items.map((def) => (
                <DraggableItem key={def.type} def={def} />
              ))}
        </div>
      )}
    </div>
  );
}

export function ComponentPalette() {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return VECTOR_CATALOG;

    const term = search.toLowerCase().trim();
    return VECTOR_CATALOG.filter(
      (def) =>
        def.displayName.toLowerCase().includes(term) ||
        def.type.toLowerCase().includes(term) ||
        def.description.toLowerCase().includes(term) ||
        def.category.toLowerCase().includes(term)
    );
  }, [search]);

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

      {/* Component list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-1 p-3">
          <CollapsibleSection kind="source" items={sources} />
          <CollapsibleSection kind="transform" items={transforms} />
          <CollapsibleSection kind="sink" items={sinks} />

          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center p-8">
              <PackageOpen className="h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">
                No components match your search.
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
