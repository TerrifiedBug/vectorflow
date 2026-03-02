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
  CircleCheck,
  CircleX,
  FileDown,
  Trash2,
  Rocket,
  BookTemplate,
  History,
  BarChart3,
  Settings,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PipelineSettings, useHasGlobalConfigContent } from "@/components/flow/pipeline-settings";
import { useFlowStore } from "@/stores/flow-store";
import { generateVectorYaml, generateVectorToml, importVectorConfig } from "@/lib/config-generator";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";

type ProcessStatusValue = "RUNNING" | "STARTING" | "STOPPED" | "CRASHED" | "PENDING";

interface FlowToolbarProps {
  pipelineId?: string;
  onSave: () => void;
  onDeploy?: () => void;
  onUndeploy?: () => void;
  onSaveAsTemplate?: () => void;
  isSaving?: boolean;
  isDraft?: boolean;
  deployedAt?: Date | string | null;
  hasConfigChanges?: boolean;
  isDirty?: boolean;
  metricsOpen?: boolean;
  onToggleMetrics?: () => void;
  processStatus?: ProcessStatusValue | null;
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
  onUndeploy,
  onSaveAsTemplate,
  isSaving,
  isDraft = true,
  deployedAt,
  hasConfigChanges = false,
  isDirty = false,
  metricsOpen = false,
  onToggleMetrics,
  processStatus,
}: FlowToolbarProps) {
  const globalConfig = useFlowStore((s) => s.globalConfig);
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
  const hasGlobalContent = useHasGlobalConfigContent();

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
    const yaml = generateVectorYaml(nodes, edges, globalConfig);
    downloadFile(yaml, "pipeline.yaml");
    toast.success("Exported as YAML");
  };

  const handleExportToml = () => {
    const toml = generateVectorToml(nodes, edges, globalConfig);
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
        const { nodes: newNodes, edges: newEdges, globalConfig: importedGlobalConfig } = importVectorConfig(content, format);
        loadGraph(newNodes, newEdges, importedGlobalConfig);
        toast.success(`Imported ${newNodes.length} components from ${file.name}`);
      } catch (err) {
        toast.error("Import failed", { description: String(err) });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleValidate = () => {
    const yaml = generateVectorYaml(nodes, edges, globalConfig);
    validateMutation.mutate({ yaml });
  };

  return (
    <TooltipProvider>
      <div className="flex h-10 items-center gap-1 px-3">
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

        {onToggleMetrics && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={metricsOpen ? "secondary" : "ghost"}
                size="sm"
                onClick={onToggleMetrics}
                className="h-7 w-7 p-0"
              >
                <BarChart3 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{metricsOpen ? "Hide metrics" : "Show metrics"}</TooltipContent>
          </Tooltip>
        )}

        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="relative h-7 w-7 p-0">
                  <Settings className="h-4 w-4" />
                  {hasGlobalContent && (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-blue-500" />
                  )}
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Pipeline settings</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-80">
            <PipelineSettings />
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Process status indicator */}
        {processStatus && (
          <div className="flex items-center gap-1.5 px-2 text-xs">
            <span className={
              processStatus === "RUNNING" ? "h-2 w-2 rounded-full bg-green-500" :
              processStatus === "CRASHED" ? "h-2 w-2 rounded-full bg-red-500" :
              processStatus === "STOPPED" ? "h-2 w-2 rounded-full bg-gray-400" :
              "h-2 w-2 rounded-full bg-yellow-500"
            } />
            <span className={
              processStatus === "RUNNING" ? "font-medium text-green-600 dark:text-green-400" :
              processStatus === "CRASHED" ? "font-medium text-red-600 dark:text-red-400" :
              processStatus === "STOPPED" ? "font-medium text-muted-foreground" :
              "font-medium text-yellow-600 dark:text-yellow-400"
            }>
              {processStatus === "RUNNING" && "Running"}
              {processStatus === "STARTING" && "Starting..."}
              {processStatus === "STOPPED" && "Stopped"}
              {processStatus === "CRASHED" && "Crashed"}
              {processStatus === "PENDING" && "Pending..."}
            </span>
          </div>
        )}

        {/* Deploy state buttons */}
        {(() => {
          const isDeployed = !isDraft && !!deployedAt;
          // Only flag redeployment when saved config actually differs from deployed
          const hasChanges = isDeployed && hasConfigChanges;

          if (!isDeployed) {
            // Never deployed or undeployed
            return (
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
            );
          }

          if (hasChanges) {
            // Deployed but has changes to deploy
            return (
              <>
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
                  <TooltipContent>Changes detected — deploy to update</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onUndeploy}
                      className="h-7 gap-1.5 px-2.5 text-xs text-destructive hover:text-destructive"
                    >
                      <CircleX className="h-3.5 w-3.5" />
                      Undeploy
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove deployed config</TooltipContent>
                </Tooltip>
              </>
            );
          }

          // Deployed and up-to-date — no redeploy needed
          return (
            <>
              <div className="flex items-center gap-1.5 px-2.5 text-xs text-green-600 dark:text-green-400">
                <CircleCheck className="h-3.5 w-3.5" />
                <span className="font-medium">Deployed</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onUndeploy}
                    className="h-7 gap-1.5 px-2.5 text-xs text-destructive hover:text-destructive"
                  >
                    <CircleX className="h-3.5 w-3.5" />
                    Undeploy
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove deployed config</TooltipContent>
              </Tooltip>
            </>
          );
        })()}

      </div>
    </TooltipProvider>
  );
}
