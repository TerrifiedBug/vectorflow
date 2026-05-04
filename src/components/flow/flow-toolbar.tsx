"use client";

import {
  forwardRef,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type ComponentType,
} from "react";
import Link from "next/link";
import {
  Save,
  Undo2,
  Redo2,
  Upload,
  CheckCircle,
  CircleCheck,
  CircleX,
  FileDown,
  Trash2,
  Rocket,
  BookTemplate,
  History,
  BarChart3,
  Gauge,
  ScrollText,
  Settings,
  Info,
  Clock,
  X,
  Sparkles,
  Keyboard,
  Search,
  LayoutGrid,
  AlertTriangle,
  ChevronDown,
  Eye,
  FileCog,
  Wrench,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PipelineSettings } from "@/components/flow/pipeline-settings";
import { cn } from "@/lib/utils";
import { useFlowStore } from "@/stores/flow-store";
import { generateVectorYaml, generateVectorToml, importVectorConfig } from "@/lib/config-generator";
import { useTRPC } from "@/trpc/client";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VersionHistoryDialog } from "@/components/pipeline/version-history-dialog";
import { KeyboardShortcutsDialog } from "@/components/flow/keyboard-shortcuts-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCanvasSearch } from "@/hooks/use-canvas-search";
import { PressableScale } from "@/components/motion";

type ProcessStatusValue = "RUNNING" | "STARTING" | "STOPPED" | "CRASHED" | "PENDING";
type ImportValidationIssue = string | { message: string; componentKey?: string };
type ImportValidationWarning = { message: string };
type ImportValidationState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "valid"; warnings: ImportValidationWarning[] }
  | { status: "invalid"; errors: ImportValidationIssue[]; warnings: ImportValidationWarning[] }
  | { status: "error"; message: string };

function getImportValidationIssueMessage(issue: ImportValidationIssue) {
  return typeof issue === "string" ? issue : issue.message;
}

function getImportValidationIssueComponent(issue: ImportValidationIssue) {
  return typeof issue === "string" ? undefined : issue.componentKey;
}

function isValidationUnavailable(errors: ImportValidationIssue[]) {
  return errors.some((error) =>
    getImportValidationIssueMessage(error).toLowerCase().includes("vector binary not found"),
  );
}

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
  logsOpen?: boolean;
  onToggleLogs?: () => void;
  hasRecentErrors?: boolean;
  processStatus?: ProcessStatusValue | null;
  gitOpsMode?: string;
  onDiscardChanges?: () => void;
  aiEnabled?: boolean;
  onAiOpen?: () => void;
  deployedVersionNumber?: number | null;
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

const ToolbarMenuButton = forwardRef<
  HTMLButtonElement,
  {
    icon: ComponentType<{ className?: string }>;
    label: string;
  } & ComponentPropsWithoutRef<typeof Button>
>(function ToolbarMenuButton({ icon: Icon, label, ...props }, ref) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs"
      aria-label={`${label} actions`}
      {...props}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
      <ChevronDown className="h-3 w-3 text-muted-foreground" />
    </Button>
  );
});

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
  logsOpen = false,
  onToggleLogs,
  hasRecentErrors = false,
  processStatus,
  gitOpsMode,
  onDiscardChanges,
  aiEnabled,
  onAiOpen,
  deployedVersionNumber,
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
  const autoLayout = useFlowStore((s) => s.autoLayout);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const canvasSearchTerm = useFlowStore((s) => s.canvasSearchTerm);
  const canvasSearchMatchIds = useFlowStore((s) => s.canvasSearchMatchIds);
  const canvasSearchActiveIndex = useFlowStore((s) => s.canvasSearchActiveIndex);
  const setCanvasSearchTerm = useFlowStore((s) => s.setCanvasSearchTerm);
  const cycleCanvasSearchMatch = useFlowStore((s) => s.cycleCanvasSearchMatch);
  const clearCanvasSearch = useFlowStore((s) => s.clearCanvasSearch);
  useCanvasSearch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importRequestIdRef = useRef(0);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importValidation, setImportValidation] = useState<ImportValidationState>({ status: "idle" });

  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  // Query pending deploy requests for this pipeline
  const pendingRequestsQuery = useQuery({
    ...trpc.deploy.listPendingRequests.queryOptions({ pipelineId: pipelineId! }),
    enabled: !!pipelineId,
  });
  const pendingRequest = (pendingRequestsQuery.data ?? [])[0];
  const isMyRequest = pendingRequest?.requestedById === session?.user?.id;

  const cancelRequestMutation = useMutation(
    trpc.deploy.cancelDeployRequest.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast.success("Deploy request cancelled");
      },
      onError: (err) => {
        toast.error("Failed to cancel request", { description: err.message , duration: 6000 });
      },
    })
  );

  const validateWithToastMutation = useMutation(trpc.validator.validate.mutationOptions({
    onSuccess: (result) => {
      if (result.valid) {
        toast.success("Pipeline is valid!");
      } else {
        const errorMsg = result.errors.map((e: { message: string }) => e.message).join("\n");
        toast.error("Validation failed", { description: errorMsg , duration: 6000 });
      }
    },
    onError: (err) => {
      toast.error("Validation error", { description: err.message , duration: 6000 });
    },
  }));
  const importValidateMutation = useMutation(trpc.validator.validate.mutationOptions());

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

  const runImport = (content: string, format?: "yaml" | "toml", sourceName = "config") => {
    const requestId = importRequestIdRef.current + 1;
    importRequestIdRef.current = requestId;

    try {
      const {
        nodes: newNodes,
        edges: newEdges,
        globalConfig: importedGlobalConfig,
        warnings,
      } = importVectorConfig(content, format);
      loadGraph(newNodes, newEdges, importedGlobalConfig);
      setImportWarnings(warnings);
      setImportValidation({ status: "validating" });
      setImportText(content);
      const yaml = generateVectorYaml(newNodes, newEdges, importedGlobalConfig);
      importValidateMutation.mutate(
        { yaml },
        {
          onSuccess: (result) => {
            if (importRequestIdRef.current !== requestId) return;

            setImportValidation(
              result.valid
                ? { status: "valid", warnings: result.warnings ?? [] }
                : isValidationUnavailable(result.errors)
                  ? { status: "error", message: result.errors.map(getImportValidationIssueMessage).join("\n") }
                  : { status: "invalid", errors: result.errors, warnings: result.warnings ?? [] },
            );
          },
          onError: (err) => {
            if (importRequestIdRef.current !== requestId) return;

            setImportValidation({ status: "error", message: err.message });
          },
        },
      );
      toast.success(`Imported ${newNodes.length} components from ${sourceName}`);
    } catch (err) {
      setImportWarnings([]);
      setImportValidation({ status: "idle" });
      toast.error("Import failed", { description: String(err) , duration: 6000 });
    }
  };

  const handlePasteImport = (format?: "yaml" | "toml") => {
    runImport(importText, format, format ? `pasted ${format.toUpperCase()}` : "pasted config");
  };

  const handleUploadImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      const format = file.name.endsWith(".toml") ? "toml" as const : file.name.endsWith(".yaml") || file.name.endsWith(".yml") ? "yaml" as const : undefined;
      runImport(content, format, file.name);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleValidate = () => {
    const yaml = generateVectorYaml(nodes, edges, globalConfig);
    validateWithToastMutation.mutate({ yaml });
  };

  return (
    <TooltipProvider>
      <div className="flex h-10 min-w-0 items-center gap-2 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {gitOpsMode === "bidirectional" && (
            <div className="flex shrink-0 items-center gap-1.5 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden lg:inline">GitOps managed — changes may be overwritten on next git push</span>
              <span className="lg:hidden">GitOps managed</span>
            </div>
          )}

        {gitOpsMode === "bidirectional" && (
          <Separator orientation="vertical" className="mx-1 h-5" />
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={onSave} disabled={isSaving || !isDirty} className={cn("relative h-7 w-7 p-0", !isDirty && "opacity-50")} aria-label="Save pipeline">
              <Save className="h-4 w-4" />
              {isDirty && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-orange-500" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save pipeline (Cmd+S)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={handleValidate} disabled={validateWithToastMutation.isPending} className="h-7 w-7 p-0" aria-label="Validate pipeline">
              <CheckCircle className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Validate pipeline</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={undo} disabled={!canUndo} className="h-7 w-7 p-0" aria-label="Undo">
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo (Cmd+Z)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={redo} disabled={!canRedo} className="h-7 w-7 p-0" aria-label="Redo">
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
              aria-label="Delete selected"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete selected (Del)</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Popover open={importOpen} onOpenChange={setImportOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Import config">
                  <Upload className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Import config (Cmd+I)</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-[420px] space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Import Vector config</div>
              <div className="text-xs text-muted-foreground">Paste YAML/TOML or upload a config file.</div>
            </div>
            <Textarea
              aria-label="Vector config"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="sources:\n  demo:\n    type: demo_logs"
              className="min-h-[180px] font-mono text-xs"
            />
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleUploadImport}>
                <Upload className="mr-2 h-4 w-4" />
                Upload
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => handlePasteImport("toml")} disabled={!importText.trim()}>
                  Import TOML
                </Button>
                <Button type="button" size="sm" onClick={() => handlePasteImport("yaml")} disabled={!importText.trim()}>
                  Import YAML
                </Button>
              </div>
            </div>
            {importWarnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                <div className="mb-1 flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {importWarnings.length} parser warning{importWarnings.length > 1 ? "s" : ""}
                </div>
                <ul className="space-y-1">
                  {importWarnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            {importValidation.status !== "idle" && (
              <div
                className={cn(
                  "rounded-md border p-2 text-xs",
                  importValidation.status === "invalid" || importValidation.status === "error"
                    ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200",
                )}
              >
                <div className="mb-1 flex items-center gap-1.5 font-medium">
                  {importValidation.status === "invalid" || importValidation.status === "error" ? (
                    <CircleX className="h-3.5 w-3.5" />
                  ) : (
                    <CircleCheck className="h-3.5 w-3.5" />
                  )}
                  {importValidation.status === "validating" && "Validating imported config..."}
                  {importValidation.status === "valid" && "Imported config is valid"}
                  {importValidation.status === "invalid" && `${importValidation.errors.length} validation error${importValidation.errors.length > 1 ? "s" : ""}`}
                  {importValidation.status === "error" && "Validation unavailable"}
                </div>
                {importValidation.status === "invalid" && (
                  <ul className="space-y-1">
                    {importValidation.errors.map((error, index) => (
                      <li key={`${getImportValidationIssueComponent(error) ?? "config"}-${getImportValidationIssueMessage(error)}-${index}`}>
                        {getImportValidationIssueComponent(error)
                          ? `${getImportValidationIssueComponent(error)}: ${getImportValidationIssueMessage(error)}`
                          : getImportValidationIssueMessage(error)}
                      </li>
                    ))}
                  </ul>
                )}
                {importValidation.status === "error" && (
                  <div>{importValidation.message}</div>
                )}
                {(importValidation.status === "valid" || importValidation.status === "invalid") && importValidation.warnings.length > 0 && (
                  <ul className="mt-1 space-y-1">
                    {importValidation.warnings.map((warning, index) => (
                      <li key={`${warning.message}-${index}`}>{warning.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </PopoverContent>
        </Popover>

        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml,.toml"
          className="hidden"
          onChange={handleFileSelected}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ToolbarMenuButton icon={FileCog} label="Config" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>Config actions</DropdownMenuLabel>
            <DropdownMenuItem onClick={handleExportYaml}>
              <FileDown className="mr-2 h-4 w-4" />
              Download YAML
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportToml}>
              <FileDown className="mr-2 h-4 w-4" />
              Download TOML
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSaveAsTemplate} disabled={nodes.length === 0}>
              <BookTemplate className="mr-2 h-4 w-4" />
              Save as template
            </DropdownMenuItem>
            {pipelineId && (
              <DropdownMenuItem onClick={() => setVersionsOpen(true)}>
                <History className="mr-2 h-4 w-4" />
                Version history
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {pipelineId && (
          <VersionHistoryDialog
            pipelineId={pipelineId}
            open={versionsOpen}
            onOpenChange={setVersionsOpen}
          />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="relative h-7 gap-1.5 px-2 text-xs" aria-label="View actions">
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">View</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
              {hasRecentErrors && !logsOpen && (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>View panels</DropdownMenuLabel>
            <DropdownMenuItem onClick={onToggleMetrics} disabled={!onToggleMetrics}>
              <BarChart3 className="mr-2 h-4 w-4" />
              {metricsOpen ? "Hide metrics" : "Show metrics"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleLogs} disabled={!onToggleLogs}>
              <ScrollText className="mr-2 h-4 w-4" />
              {logsOpen ? "Hide logs" : "Show logs"}
              {hasRecentErrors && !logsOpen && (
                <span className="ml-auto h-2 w-2 rounded-full bg-red-500" />
              )}
            </DropdownMenuItem>
            {pipelineId && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={`/pipelines/${pipelineId}/scorecard`}>
                    <Gauge className="mr-2 h-4 w-4" />
                    Pipeline scorecard
                  </Link>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="relative flex items-center gap-1">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={canvasSearchTerm}
            onChange={(e) => setCanvasSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                cycleCanvasSearchMatch(e.shiftKey ? "prev" : "next");
              }
              if (e.key === "Escape") {
                e.preventDefault();
                clearCanvasSearch();
              }
            }}
            placeholder="Search nodes..."
            className="h-7 w-[120px] pl-7 text-xs md:w-[140px]"
          />
          {canvasSearchTerm && canvasSearchMatchIds.length > 0 && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {canvasSearchActiveIndex + 1}/{canvasSearchMatchIds.length}
            </span>
          )}
          {canvasSearchTerm && canvasSearchMatchIds.length === 0 && (
            <span className="text-xs text-destructive whitespace-nowrap">
              No matches
            </span>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ToolbarMenuButton icon={Wrench} label="Tools" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>Canvas tools</DropdownMenuLabel>
            {aiEnabled && (
              <DropdownMenuItem onClick={onAiOpen}>
                <Sparkles className="mr-2 h-4 w-4" />
                AI assistant
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => autoLayout(selectedNodeIds.size > 1)}
              disabled={nodes.length === 0}
            >
              <LayoutGrid className="mr-2 h-4 w-4" />
              {selectedNodeIds.size > 1 ? "Auto-layout selected" : "Auto-layout all"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>
              <Keyboard className="mr-2 h-4 w-4" />
              Keyboard shortcuts
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Pipeline settings">
                  <Settings className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Pipeline settings</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-80">
            <PipelineSettings pipelineId={pipelineId} />
          </PopoverContent>
        </Popover>
        <KeyboardShortcutsDialog
          open={shortcutsOpen}
          onOpenChange={setShortcutsOpen}
        />

        </div>

        <div className="flex shrink-0 items-center gap-1 border-l pl-2">
          {/* Pending approval indicator */}
          {pendingRequest && (
            <div className="flex items-center gap-0.5 px-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-md text-amber-600 dark:text-amber-400">
                    <Clock className="h-4 w-4" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Pending Approval
                  {pendingRequest.requestedBy && (
                    <> by {pendingRequest.requestedBy.name ?? pendingRequest.requestedBy.email}</>
                  )}
                </TooltipContent>
              </Tooltip>
              {isMyRequest && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelRequestMutation.mutate({ requestId: pendingRequest.id })}
                      disabled={cancelRequestMutation.isPending}
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      aria-label="Cancel deploy request"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Cancel your deploy request</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}

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
                <PressableScale>
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
                </PressableScale>
              );
            }

            if (hasChanges) {
              // Deployed but has changes to deploy
              return (
                <>
                  <PressableScale>
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
                      <TooltipContent>Changes detected{deployedVersionNumber != null ? ` since v${deployedVersionNumber}` : ''} — deploy to update</TooltipContent>
                    </Tooltip>
                  </PressableScale>
                  {onDiscardChanges && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={onDiscardChanges}
                          className="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          Discard
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Revert to last deployed state</TooltipContent>
                    </Tooltip>
                  )}
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
                  <span className="font-medium">Deployed{deployedVersionNumber != null ? ` v${deployedVersionNumber}` : ''}</span>
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
      </div>
    </TooltipProvider>
  );
}
