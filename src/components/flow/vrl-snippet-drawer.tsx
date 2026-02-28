"use client";

import { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VRL_SNIPPETS, type VrlSnippet } from "@/lib/vrl/snippets";

interface VrlSnippetDrawerProps {
  onInsert: (code: string) => void;
}

const CATEGORIES = [
  "Parsing", "Filtering", "Enrichment", "Type Coercion",
  "Encoding", "String", "Timestamp", "Networking",
] as const;

export function VrlSnippetDrawer({ onInsert }: VrlSnippetDrawerProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!search.trim()) return VRL_SNIPPETS;
    const q = search.toLowerCase();
    return VRL_SNIPPETS.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q),
    );
  }, [search]);

  const grouped = useMemo(() => {
    const map = new Map<string, VrlSnippet[]>();
    for (const cat of CATEGORIES) {
      const items = filtered.filter((s) => s.category === cat);
      if (items.length > 0) map.set(cat, items);
    }
    return map;
  }, [filtered]);

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="flex max-h-64 w-full flex-col rounded border bg-muted/20">
      <div className="border-b p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search snippets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-1">
          {grouped.size === 0 && (
            <p className="p-3 text-center text-xs text-muted-foreground">
              No snippets found
            </p>
          )}
          {Array.from(grouped.entries()).map(([category, snippets]) => (
            <div key={category}>
              <button
                onClick={() => toggleCategory(category)}
                className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/50"
              >
                {collapsed.has(category) ? (
                  <ChevronRight className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {category}
                <span className="ml-auto text-[10px] font-normal">
                  {snippets.length}
                </span>
              </button>
              {!collapsed.has(category) &&
                snippets.map((snippet) => (
                  <button
                    key={snippet.id}
                    onClick={() => onInsert(snippet.code)}
                    className="group flex w-full flex-col gap-0.5 rounded px-3 py-1.5 text-left hover:bg-accent"
                    title={snippet.code}
                  >
                    <span className="text-xs font-medium">{snippet.name}</span>
                    <span className="line-clamp-1 text-[10px] text-muted-foreground">
                      {snippet.description}
                    </span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
