"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, AlertTriangle, Loader2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Types ──────────────────────────────────────────────────────────────────

interface KVPair {
  key: string;
  value: string;
}

interface NodeGroupFormState {
  name: string;
  criteria: KVPair[];
  labelTemplate: KVPair[];
  requiredLabels: string[];
  requiredLabelInput: string;
}

const emptyForm = (): NodeGroupFormState => ({
  name: "",
  criteria: [],
  labelTemplate: [],
  requiredLabels: [],
  requiredLabelInput: "",
});

// ─── Key-Value Editor ────────────────────────────────────────────────────────

function KVEditor({
  pairs,
  onChange,
  placeholder,
}: {
  pairs: KVPair[];
  onChange: (pairs: KVPair[]) => void;
  placeholder?: string;
}) {
  const addRow = () => onChange([...pairs, { key: "", value: "" }]);
  const removeRow = (i: number) => onChange(pairs.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: "key" | "value", val: string) => {
    const updated = pairs.map((p, idx) =>
      idx === i ? { ...p, [field]: val } : p,
    );
    onChange(updated);
  };

  return (
    <div className="space-y-1.5">
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={pair.key}
            onChange={(e) => updateRow(i, "key", e.target.value)}
            placeholder="key"
            className="h-7 text-xs flex-1"
          />
          <span className="text-muted-foreground text-xs">=</span>
          <Input
            value={pair.value}
            onChange={(e) => updateRow(i, "value", e.target.value)}
            placeholder="value"
            className="h-7 text-xs flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => removeRow(i)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={addRow}
      >
        <Plus className="h-3 w-3 mr-1" />
        {placeholder ?? "Add row"}
      </Button>
    </div>
  );
}

// ─── Tag Input ───────────────────────────────────────────────────────────────

function TagInput({
  tags,
  inputValue,
  onTagsChange,
  onInputChange,
}: {
  tags: string[];
  inputValue: string;
  onTagsChange: (tags: string[]) => void;
  onInputChange: (value: string) => void;
}) {
  const addTag = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const newTags = trimmed
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && !tags.includes(t));
    if (newTags.length > 0) onTagsChange([...tags, ...newTags]);
    onInputChange("");
  };

  return (
    <div className="space-y-1.5">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1 pr-1">
              {tag}
              <button
                type="button"
                onClick={() => onTagsChange(tags.filter((t) => t !== tag))}
                className="rounded-sm hover:bg-muted"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <Input
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag(inputValue);
            } else if (e.key === ",") {
              e.preventDefault();
              addTag(inputValue);
            }
          }}
          placeholder="label-key (Enter or comma to add)"
          className="h-7 text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs shrink-0"
          onClick={() => addTag(inputValue)}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function kvPairsToRecord(pairs: KVPair[]): Record<string, string> {
  return Object.fromEntries(
    pairs.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value.trim()]),
  );
}

function recordToKVPairs(record: Record<string, string>): KVPair[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

// ─── Group Form ──────────────────────────────────────────────────────────────

function GroupForm({
  form,
  onChange,
  onSubmit,
  onCancel,
  isPending,
  submitLabel,
}: {
  form: NodeGroupFormState;
  onChange: (form: NodeGroupFormState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
  submitLabel: string;
}) {
  const criteriaEmpty = form.criteria.length === 0 || form.criteria.every((p) => !p.key.trim());

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-4">
      {/* Name */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Name *</Label>
        <Input
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="e.g. US East Production"
          className="h-8"
          maxLength={100}
          autoFocus
        />
      </div>

      {/* Criteria */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Criteria (label selector)</Label>
        <KVEditor
          pairs={form.criteria}
          onChange={(pairs) => onChange({ ...form, criteria: pairs })}
          placeholder="Add criterion"
        />
        {criteriaEmpty && (
          <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            This group will match all enrolling nodes
          </div>
        )}
      </div>

      {/* Label Template */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Label template</Label>
        <p className="text-[11px] text-muted-foreground">
          Labels applied automatically to nodes that match this group&apos;s criteria at enrollment.
        </p>
        <KVEditor
          pairs={form.labelTemplate}
          onChange={(pairs) => onChange({ ...form, labelTemplate: pairs })}
          placeholder="Add label"
        />
      </div>

      {/* Required Labels */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Required labels</Label>
        <p className="text-[11px] text-muted-foreground">
          Label keys every node should have. Missing keys show a Non-compliant badge on the fleet list.
        </p>
        <TagInput
          tags={form.requiredLabels}
          inputValue={form.requiredLabelInput}
          onTagsChange={(tags) => onChange({ ...form, requiredLabels: tags })}
          onInputChange={(val) => onChange({ ...form, requiredLabelInput: val })}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onSubmit}
          disabled={!form.name.trim() || isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Saving...
            </>
          ) : (
            submitLabel
          )}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface NodeGroupManagementProps {
  environmentId: string;
}

export function NodeGroupManagement({ environmentId }: NodeGroupManagementProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const groupsQuery = useQuery(
    trpc.nodeGroup.list.queryOptions({ environmentId }),
  );
  const groups = groupsQuery.data ?? [];

  // --- Create ---
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<NodeGroupFormState>(emptyForm());

  const createMutation = useMutation(
    trpc.nodeGroup.create.mutationOptions({
      onSuccess: () => {
        toast.success("Node group created");
        setShowCreate(false);
        setCreateForm(emptyForm());
        queryClient.invalidateQueries({ queryKey: trpc.nodeGroup.list.queryKey() });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const handleCreate = () => {
    if (!createForm.name.trim()) return;
    createMutation.mutate({
      environmentId,
      name: createForm.name.trim(),
      criteria: kvPairsToRecord(createForm.criteria),
      labelTemplate: kvPairsToRecord(createForm.labelTemplate),
      requiredLabels: createForm.requiredLabels,
    });
  };

  // --- Edit ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<NodeGroupFormState>(emptyForm());

  const updateMutation = useMutation(
    trpc.nodeGroup.update.mutationOptions({
      onSuccess: () => {
        toast.success("Node group updated");
        setEditingId(null);
        queryClient.invalidateQueries({ queryKey: trpc.nodeGroup.list.queryKey() });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const startEdit = (group: {
    id: string;
    name: string;
    criteria: Record<string, string>;
    labelTemplate: Record<string, string>;
    requiredLabels: string[];
  }) => {
    setEditingId(group.id);
    setEditForm({
      name: group.name,
      criteria: recordToKVPairs(group.criteria),
      labelTemplate: recordToKVPairs(group.labelTemplate),
      requiredLabels: group.requiredLabels,
      requiredLabelInput: "",
    });
    setShowCreate(false);
  };

  const handleUpdate = () => {
    if (!editingId || !editForm.name.trim()) return;
    updateMutation.mutate({
      id: editingId,
      name: editForm.name.trim(),
      criteria: kvPairsToRecord(editForm.criteria),
      labelTemplate: kvPairsToRecord(editForm.labelTemplate),
      requiredLabels: editForm.requiredLabels,
    });
  };

  // --- Delete ---
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const deleteMutation = useMutation(
    trpc.nodeGroup.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Node group deleted");
        setDeleteTarget(null);
        queryClient.invalidateQueries({ queryKey: trpc.nodeGroup.list.queryKey() });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Node Groups</CardTitle>
              <CardDescription>
                Segment your fleet into logical clusters. Groups define label selectors, templates applied at enrollment, and required label keys for compliance.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowCreate(true);
                setEditingId(null);
              }}
              disabled={showCreate}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Group
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Create form */}
          {showCreate && (
            <GroupForm
              form={createForm}
              onChange={setCreateForm}
              onSubmit={handleCreate}
              onCancel={() => { setShowCreate(false); setCreateForm(emptyForm()); }}
              isPending={createMutation.isPending}
              submitLabel="Create Group"
            />
          )}

          {/* Loading skeleton */}
          {groupsQuery.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {/* Empty state */}
          {!groupsQuery.isLoading && groups.length === 0 && !showCreate && (
            <p className="text-sm text-muted-foreground py-2">
              No node groups yet. Click &quot;Add Group&quot; to create one.
            </p>
          )}

          {/* Group list */}
          <div className="space-y-3">
            {groups.map((group) =>
              editingId === group.id ? (
                <GroupForm
                  key={group.id}
                  form={editForm}
                  onChange={setEditForm}
                  onSubmit={handleUpdate}
                  onCancel={() => setEditingId(null)}
                  isPending={updateMutation.isPending}
                  submitLabel="Save Changes"
                />
              ) : (
                <div
                  key={group.id}
                  className="flex items-start gap-3 rounded-md border px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <span className="font-medium text-sm">{group.name}</span>

                    {/* Criteria */}
                    {Object.keys((group.criteria as Record<string, string>) ?? {}).length > 0 ? (
                      <div className="flex flex-wrap gap-1 items-center">
                        <span className="text-[11px] text-muted-foreground shrink-0">Criteria:</span>
                        {Object.entries((group.criteria as Record<string, string>) ?? {}).map(([k, v]) => (
                          <Badge key={k} variant="outline" className="text-[10px] px-1.5 py-0">
                            {k}={v}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 text-[11px]">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Matches all enrolling nodes
                      </div>
                    )}

                    {/* Label Template */}
                    {Object.keys((group.labelTemplate as Record<string, string>) ?? {}).length > 0 && (
                      <div className="flex flex-wrap gap-1 items-center">
                        <span className="text-[11px] text-muted-foreground shrink-0">Template:</span>
                        {Object.entries((group.labelTemplate as Record<string, string>) ?? {}).map(([k, v]) => (
                          <Badge key={k} variant="secondary" className="text-[10px] px-1.5 py-0">
                            {k}={v}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Required Labels */}
                    {((group.requiredLabels as string[]) ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1 items-center">
                        <span className="text-[11px] text-muted-foreground shrink-0">Required:</span>
                        {((group.requiredLabels as string[]) ?? []).map((label: string) => (
                          <Badge key={label} variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/50 text-amber-700 dark:text-amber-400">
                            {label}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0 pt-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() =>
                        startEdit({
                          id: group.id,
                          name: group.name,
                          criteria: group.criteria as Record<string, string>,
                          labelTemplate: group.labelTemplate as Record<string, string>,
                          requiredLabels: (group.requiredLabels as string[]) ?? [],
                        })
                      }
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => setDeleteTarget({ id: group.id, name: group.name })}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ),
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Delete node group?"
        description={
          <>
            Deleting &quot;{deleteTarget?.name}&quot; will not affect existing nodes, but nodes will
            no longer be auto-labeled or compliance-checked against this group.
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
