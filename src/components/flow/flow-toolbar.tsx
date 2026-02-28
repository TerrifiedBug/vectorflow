"use client";

import { useRef } from "react";
import Link from "next/link";
import {
  Save,
  Undo2,
  Redo2,
  Upload,
  Download,
  CheckCircle,
  Pencil,
  Activity,
  FileDown,
  Trash2,
  Rocket,
  BookTemplate,
  History,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFlowStore } from "@/stores/flow-store";
import { generateVectorYaml, generateVectorToml, importVectorConfig } from "@/lib/config-generator";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";

interface FlowToolbarProps {
  pipelineId?: string;
  onSave: () => void;
  onDeploy?: () => void;
  onSaveAsTemplate?: () => void;
  isSaving?: boolean;
  monitorMode?: boolean;
  onToggleMonitor?: (enabled: boolean) => void;
}

function downloadFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function FlowToolbar({
  pipelineId,
  onSave,
  onDeploy,
  onSaveAsTemplate,
  isSaving,
  monitorMode = false,
  onToggleMonitor,
}: FlowToolbarProps) {
  const canUndo = useFlowStore((s) => s.canUndo);
  const canRedo = useFlowStore((s) => s.canRedo);
  const undo = useFlowStore((s) => s.undo);
  const redo = useFlowStore((s) => s.redo);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const selectedEdgeId = useFlowStore((s) => s.selectedEdgeId);
  const removeNode = useFlowStore((s) => s.removeNode);
  const removeEdge = useFlowStore((s) => s.removeEdge);
  const loadGraph = useFlowStore((s) => s.loadGraph);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trpc = useTRPC();
  const validateMutation = useMutation(trpc.validator.validate.mutationOptions({
    onSuccess: (result) => {
      if (result.valid) {
        toast.success("Pipeline is valid!");
      } else {
        const errorMsg = result.errors.map((e: { message: string }) => e.message).join("\n");
        toast.error("Validation failed", { description: errorMsg });
      }
    },
    onError: (err) => {
      toast.error("Validation error", { description: err.message });
    },
  }));

  const handleExportYaml = () => {
    const yaml = generateVectorYaml(nodes, edges);
    downloadFile(yaml, "pipeline.yaml");
    toast.success("Exported as YAML");
  };

  const handleExportToml = () => {
    const toml = generateVectorToml(nodes, edges);
    downloadFile(toml, "pipeline.toml");
    toast.success("Exported as TOML");
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const content = reader.result as string;
        const format = file.name.endsWith(".toml") ? "toml" : "yaml";
        const { nodes: newNodes, edges: newEdges } = importVectorConfig(content, format);
        loadGraph(newNodes, newEdges);
        toast.success(`Imported ${newNodes.length} components from ${file.name}`);
      } catch (err) {
        toast.error("Import failed", { description: String(err) });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleValidate = () => {
    const yaml = generateVectorYaml(nodes, edges);
    validateMutation.mutate({ yaml });
  };

  return (
    <TooltipProvider>
      <div className="flex h-10 items-center gap-1 border-b bg-background px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={onSave} disabled={isSaving} className="h-7 w-7 p-0">
              <Save className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save pipeline (Cmd+S)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={handleValidate} disabled={validateMutation.isPending} className="h-7 w-7 p-0">
              <CheckCircle className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Validate pipeline</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={undo} disabled={!canUndo} className="h-7 w-7 p-0">
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo (Cmd+Z)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={redo} disabled={!canRedo} className="h-7 w-7 p-0">
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo (Cmd+Shift+Z)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (selectedNodeId) removeNode(selectedNodeId);
                else if (selectedEdgeId) removeEdge(selectedEdgeId);
              }}
              disabled={!selectedNodeId && !selectedEdgeId}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete selected (Del)</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={handleImport} className="h-7 w-7 p-0">
              <Upload className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Import config</TooltipContent>
        </Tooltip>

        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml,.toml"
          className="hidden"
          onChange={handleFileSelected}
        />

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <Download className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Export config</TooltipContent>
          </Tooltip>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={handleExportYaml}>
              <FileDown className="mr-2 h-4 w-4" />
              Download YAML
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportToml}>
              <FileDown className="mr-2 h-4 w-4" />
              Download TOML
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSaveAsTemplate}
              disabled={nodes.length === 0}
              className="h-7 w-7 p-0"
            >
              <BookTemplate className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save as template</TooltipContent>
        </Tooltip>

        {pipelineId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                <Link href={`/pipelines/${pipelineId}/versions`}>
                  <History className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Version history &amp; rollback</TooltipContent>
          </Tooltip>
        )}

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="default"
              size="sm"
              onClick={onDeploy}
              disabled={nodes.length === 0}
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              <Rocket className="h-3.5 w-3.5" />
              Deploy
            </Button>
          </TooltipTrigger>
          <TooltipContent>Deploy pipeline to environment</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={monitorMode ? "default" : "ghost"}
              size="sm"
              onClick={() => onToggleMonitor?.(!monitorMode)}
              className="relative h-7 w-7 p-0"
            >
              {monitorMode ? <Activity className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
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
