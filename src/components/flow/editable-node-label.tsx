"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useFlowStore } from "@/stores/flow-store";

interface EditableNodeLabelProps {
  nodeId: string;
  value: string;
  disabled?: boolean;
}

export function EditableNodeLabel({ nodeId, value, disabled }: EditableNodeLabelProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateNodeKey = useFlowStore((s) => s.updateNodeKey);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== value) {
      updateNodeKey(nodeId, trimmed);
    } else {
      setEditValue(value);
    }
    setEditing(false);
  }, [editValue, value, nodeId, updateNodeKey]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setEditValue(value); setEditing(false); }
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-transparent text-sm font-medium text-foreground outline-none border-b border-primary px-0 py-0"
      />
    );
  }

  return (
    <p
      onDoubleClick={(e) => { e.stopPropagation(); setEditValue(value); setEditing(true); }}
      className={cn(
        "truncate text-sm font-medium text-foreground cursor-text",
        disabled && "line-through",
      )}
      title="Double-click to rename"
    >
      {value}
    </p>
  );
}
