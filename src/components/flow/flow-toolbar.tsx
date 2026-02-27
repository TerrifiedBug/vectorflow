"use client";

import {
  Save,
  Undo2,
  Redo2,
  Upload,
  Download,
  CheckCircle,
  Pencil,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useFlowStore } from "@/stores/flow-store";

interface FlowToolbarProps {
  onSave: () => void;
  isSaving?: boolean;
  monitorMode?: boolean;
  onToggleMonitor?: (enabled: boolean) => void;
}

export function FlowToolbar({
  onSave,
  isSaving,
  monitorMode = false,
  onToggleMonitor,
}: FlowToolbarProps) {
  const canUndo = useFlowStore((s) => s.canUndo);
  const canRedo = useFlowStore((s) => s.canRedo);
  const undo = useFlowStore((s) => s.undo);
  const redo = useFlowStore((s) => s.redo);

  return (
    <TooltipProvider>
      <div className="flex h-10 items-center gap-1 border-b bg-background px-3">
        {/* Save */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onSave}
              disabled={isSaving}
            >
              <Save className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save pipeline</TooltipContent>
        </Tooltip>

        {/* Validate */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => toast.info("Validation coming soon")}
            >
              <CheckCircle className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Validate pipeline</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Undo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={undo}
              disabled={!canUndo}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo</TooltipContent>
        </Tooltip>

        {/* Redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={redo}
              disabled={!canRedo}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Import */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => toast.info("Import coming soon")}
            >
              <Upload className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Import config</TooltipContent>
        </Tooltip>

        {/* Export */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => toast.info("Export coming soon")}
            >
              <Download className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Export config</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Edit / Monitor toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={monitorMode ? "default" : "ghost"}
              size="icon-sm"
              onClick={() => onToggleMonitor?.(!monitorMode)}
              className="relative"
            >
              {monitorMode ? (
                <Activity className="h-4 w-4" />
              ) : (
                <Pencil className="h-4 w-4" />
              )}
              {monitorMode && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-green-500" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {monitorMode ? "Switch to Edit mode" : "Switch to Monitor mode"}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
