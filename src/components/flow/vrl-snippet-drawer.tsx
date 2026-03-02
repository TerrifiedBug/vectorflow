"use client";

import { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronRight, Plus, Pencil, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VRL_SNIPPETS, type VrlSnippet } from "@/lib/vrl/snippets";
import { useTRPC } from "@/trpc/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTeamStore } from "@/stores/team-store";

interface VrlSnippetDrawerProps {
  onInsert: (code: string) => void;
}

const CATEGORIES = [
  "Parsing", "Filtering", "Enrichment", "Type Coercion",
  "Encoding", "String", "Timestamp", "Networking",
] as const;

export function VrlSnippetDrawer({ onInsert }: VrlSnippetDrawerProps) {
  const teamId = useTeamStore((s) => s.selectedTeamId);
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "", category: "Custom", code: "" });

  const snippetsQuery = useQuery(
    trpc.vrlSnippet.list.queryOptions({ teamId: teamId ?? "" }, { enabled: !!teamId })
  );

  const createMutation = useMutation(
    trpc.vrlSnippet.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.vrlSnippet.list.queryKey({ teamId: teamId ?? "" }) });
        resetForm();
      },
    })
  );

  const updateMutation = useMutation(
    trpc.vrlSnippet.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.vrlSnippet.list.queryKey({ teamId: teamId ?? "" }) });
        resetForm();
      },
    })
  );

  const deleteMutation = useMutation(
    trpc.vrlSnippet.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.vrlSnippet.list.queryKey({ teamId: teamId ?? "" }) });
      },
    })
  );

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setFormData({ name: "", description: "", category: "Custom", code: "" });
  }

  function handleEdit(snippet: { id: string; name: string; description: string; category: string; code: string }) {
    setEditingId(snippet.id);
    setFormData({ name: snippet.name, description: snippet.description, category: snippet.category, code: snippet.code });
    setShowForm(true);
  }

  function handleSave() {
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...formData });
    } else {
      createMutation.mutate({ teamId: teamId ?? "", ...formData });
    }
  }

  const allSnippets = useMemo(() => {
    const builtIn = (snippetsQuery.data?.builtIn ?? VRL_SNIPPETS).map((s) => ({ ...s, isCustom: false as const }));
    const custom = (snippetsQuery.data?.custom ?? []).map((s) => ({ ...s, isCustom: true as const }));
    return [...builtIn, ...custom];
  }, [snippetsQuery.data]);

  const allCategories = useMemo(() => {
    const customCategories = allSnippets
      .filter((s) => s.isCustom)
      .map((s) => s.category)
      .filter((c) => !CATEGORIES.includes(c as (typeof CATEGORIES)[number]));
    return [...CATEGORIES, ...new Set(customCategories)];
  }, [allSnippets]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allSnippets;
    const q = search.toLowerCase();
    return allSnippets.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q),
    );
  }, [search, allSnippets]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof allSnippets>();
    for (const cat of allCategories) {
      const items = filtered.filter((s) => s.category === cat);
      if (items.length > 0) map.set(cat, items);
    }
    return map;
  }, [filtered, allCategories]);

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="flex max-h-64 w-full flex-col overflow-hidden rounded border bg-muted/20">
      <div className="border-b p-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search snippets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 shrink-0"
          onClick={() => setShowForm(true)}
          title="New snippet"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {showForm && (
        <div className="border-b p-2 space-y-2">
          <Input
            placeholder="Snippet name"
            value={formData.name}
            onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
            className="h-7 text-xs"
          />
          <Input
            placeholder="Description (optional)"
            value={formData.description}
            onChange={(e) => setFormData((d) => ({ ...d, description: e.target.value }))}
            className="h-7 text-xs"
          />
          <select
            value={formData.category}
            onChange={(e) => setFormData((d) => ({ ...d, category: e.target.value }))}
            className="w-full h-7 rounded border bg-background px-2 text-xs"
          >
            {[...CATEGORIES, "Custom"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <textarea
            placeholder="VRL code..."
            value={formData.code}
            onChange={(e) => setFormData((d) => ({ ...d, code: e.target.value }))}
            className="w-full rounded border bg-background p-2 text-xs font-mono h-20 resize-none"
          />
          <div className="flex gap-1 justify-end">
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={resetForm}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 text-xs"
              onClick={handleSave}
              disabled={!formData.name || !formData.code}
            >
              {editingId ? "Update" : "Create"}
            </Button>
          </div>
        </div>
      )}
      <ScrollArea className="flex-1 min-h-0">
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
                <span className="ml-auto text-xs font-normal">
                  {snippets.length}
                </span>
              </button>
              {!collapsed.has(category) &&
                snippets.map((snippet) => (
                  <button
                    key={snippet.id}
                    onClick={() => onInsert(snippet.code)}
                    className="group flex w-full items-center gap-0.5 rounded px-3 py-1.5 text-left hover:bg-accent"
                    title={snippet.code}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium">{snippet.name}</span>
                        {snippet.isCustom && (
                          <Badge variant="secondary" className="text-[10px] px-1 py-0 leading-tight">Custom</Badge>
                        )}
                      </div>
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {snippet.description}
                      </span>
                    </div>
                    {snippet.isCustom && (
                      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEdit(snippet); }}
                          className="rounded p-0.5 hover:bg-muted"
                          title="Edit"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteMutation.mutate({ id: snippet.id }); }}
                          className="rounded p-0.5 hover:bg-muted text-destructive"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
