"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const GROUP_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#64748b",
] as const;

interface ManageGroupsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: string;
}

export function ManageGroupsDialog({
  open,
  onOpenChange,
  environmentId,
}: ManageGroupsDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const groupsQuery = useQuery(
    trpc.pipelineGroup.list.queryOptions(
      { environmentId },
      { enabled: open && !!environmentId },
    ),
  );
  const groups = groupsQuery.data ?? [];

  // Compute group depths for parent selector (filter out depth-3 groups, they can't have children)
  const groupDepths = new Map<string, number>();
  function computeDepths() {
    const byId = new Map(groups.map((g) => [g.id, g]));
    for (const g of groups) {
      let depth = 1;
      let current: typeof g | undefined = g;
      while (current?.parentId) {
        depth++;
        current = byId.get(current.parentId);
      }
      groupDepths.set(g.id, depth);
    }
  }
  computeDepths();

  // Groups that can be parents (depth 1 or 2 — children would be depth 2 or 3 max)
  const eligibleParents = groups.filter((g) => (groupDepths.get(g.id) ?? 1) < 3);

  // --- Create ---
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(GROUP_COLORS[0]);
  const [newParentId, setNewParentId] = useState<string>("__root__");

  const createMutation = useMutation(
    trpc.pipelineGroup.create.mutationOptions({
      onSuccess: () => {
        toast.success("Group created");
        setNewName("");
        setNewColor(GROUP_COLORS[0]);
        setNewParentId("__root__");
        queryClient.invalidateQueries({ queryKey: trpc.pipelineGroup.list.queryKey() });
      },
      onError: (err) => toast.error(err.message, { duration: 6000 }),
    }),
  );

  // --- Edit ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string>("");

  const updateMutation = useMutation(
    trpc.pipelineGroup.update.mutationOptions({
      onSuccess: () => {
        toast.success("Group updated");
        setEditingId(null);
        queryClient.invalidateQueries({ queryKey: trpc.pipelineGroup.list.queryKey() });
      },
      onError: (err) => toast.error(err.message, { duration: 6000 }),
    }),
  );

  // --- Delete ---
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const deleteMutation = useMutation(
    trpc.pipelineGroup.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Group deleted");
        setDeleteTarget(null);
        queryClient.invalidateQueries({ queryKey: trpc.pipelineGroup.list.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.list.queryKey() });
      },
      onError: (err) => toast.error(err.message, { duration: 6000 }),
    }),
  );

  const startEdit = (group: { id: string; name: string; color: string | null }) => {
    setEditingId(group.id);
    setEditName(group.name);
    setEditColor(group.color ?? GROUP_COLORS[0]);
  };

  const cancelEdit = () => setEditingId(null);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Groups</DialogTitle>
          </DialogHeader>

          {/* Create form */}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              createMutation.mutate({
                environmentId,
                name: newName.trim(),
                color: newColor,
                parentId: newParentId === "__root__" ? undefined : newParentId,
              });
            }}
          >
            <div className="flex items-center gap-2">
              <ColorPicker value={newColor} onChange={setNewColor} />
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New group name..."
                className="h-8 text-sm"
                maxLength={100}
              />
              <Button
                type="submit"
                size="sm"
                className="h-8 shrink-0"
                disabled={!newName.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            {eligibleParents.length > 0 && (
              <Select value={newParentId} onValueChange={setNewParentId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Parent group (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">
                    <span className="text-muted-foreground">(Root level)</span>
                  </SelectItem>
                  {eligibleParents.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: g.color ?? "#64748b" }}
                        />
                        {g.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </form>

          {/* Group list */}
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {groups.length === 0 && !groupsQuery.isLoading && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No groups yet
              </p>
            )}
            {groups.map((group) =>
              editingId === group.id ? (
                <form
                  key={group.id}
                  className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!editName.trim()) return;
                    updateMutation.mutate({
                      id: group.id,
                      name: editName.trim(),
                      color: editColor,
                    });
                  }}
                >
                  <ColorPicker value={editColor} onChange={setEditColor} />
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-7 text-sm"
                    maxLength={100}
                    autoFocus
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={!editName.trim() || updateMutation.isPending}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={cancelEdit}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <div
                  key={group.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: group.color ?? "#64748b" }}
                  />
                  <span className="flex-1 text-sm truncate">{group.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {group._count.pipelines}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => startEdit(group)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive"
                    onClick={() => setDeleteTarget({ id: group.id, name: group.name })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ),
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Delete group?"
        description={
          <>
            Deleting &quot;{deleteTarget?.name}&quot; will ungroup all pipelines in it.
            The pipelines themselves will not be deleted.
          </>
        }
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id });
        }}
      />
    </>
  );
}

// --- Inline color picker ---

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        className="h-6 w-6 shrink-0 rounded-full border-2 border-background ring-1 ring-border"
        style={{ backgroundColor: value }}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="absolute left-0 top-8 z-50 flex gap-1 rounded-md border bg-popover p-2 shadow-md">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="h-5 w-5 rounded-full ring-1 ring-border"
              style={{
                backgroundColor: c,
                outline: c === value ? "2px solid currentColor" : "none",
                outlineOffset: "2px",
              }}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
