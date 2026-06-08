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
  LayoutGrid,
  AlertTriangle,
  ChevronDown,
  Eye,
  MoreHorizontal,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PipelineSettings } from "@/components/flow/pipeline-settings";
import { cn } from "@/lib/utils";
import { useFlowStore } from "@/stores/flow-store";
import {
  generateVectorYaml,
  generateVectorToml,
  importVectorConfig,
  diffImportedGraph,
  type ImportGraphDiff,
} from "@/lib/config-generator";
import type { Node, Edge } from "@xyflow/react";
import { useTRPC } from "@/trpc/client";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VersionHistoryDialog } from "@/components/pipeline/version-history-dialog";
import { KeyboardShortcutsDialog } from "@/components/flow/keyboard-shortcuts-dialog";
import { Textarea } from "@/components/ui/textarea";
import { PressableScale } from "@/components/motion";
import { useMediaQuery } from "@/hooks/use-media-query";

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
  /** Optional pipeline name shown in the toolbar (mono 13px). */
  pipelineName?: string;
  /** Optional environment name to render as a Pill next to the pipeline name. */
  environmentName?: string;
  /** Optional human-readable "last saved" label (e.g. "14s ago"). */
  lastSavedLabel?: string;
  /** Total node count, surfaced in the running/paused status text. */
  nodeCount?: number;
  /** When provided, the pipeline name becomes click-to-edit; called with the trimmed new name on commit. */
  onRename?: (name: string) => void;
  /** Disables the inline rename input while a rename request is pending. */
  isRenaming?: boolean;
  /** Current editor validation error count; deploy is blocked while non-zero. */
  validationErrorCount?: number;
  /** Human-readable first validation error for the toolbar status/tooltip. */
  validationMessage?: string;
}

const PROCESS_STATUS_DOT: Record<ProcessStatusValue, "healthy" | "error" | "neutral" | "info" | "idle"> = {
  RUNNING: "healthy",
  STARTING: "info",
  STOPPED: "idle",
  CRASHED: "error",
  PENDING: "info",
};

const PROCESS_STATUS_LABEL: Record<ProcessStatusValue, string> = {
  RUNNING: "running",
  STARTING: "starting",
  STOPPED: "paused",
  CRASHED: "crashed",
  PENDING: "pending",
};

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
  pipelineName,
  environmentName,
  lastSavedLabel,
  nodeCount,
  onRename,
  isRenaming = false,
  validationErrorCount = 0,
  validationMessage,
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importRequestIdRef = useRef(0);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importValidation, setImportValidation] = useState<ImportValidationState>({ status: "idle" });
  const [pendingImport, setPendingImport] = useState<{
    nodes: Node[];
    edges: Edge[];
    globalConfig: Record<string, unknown> | null;
    sourceName: string;
  } | null>(null);
  const [importDiff, setImportDiff] = useState<ImportGraphDiff | null>(null);
  const [renameEditing, setRenameEditing] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");

  // Guards against double-fire when Enter triggers commit AND the focus loss
  // on input unmount fires onBlur, which would re-invoke commit. Both handlers
  // dispatch synchronously in the same React batch, so we use a ref (not state)
  // to short-circuit the second call.
  const renameCommittedRef = useRef(false);

  const startRename = () => {
    if (!onRename) return;
    setRenameDraft(pipelineName ?? "");
    renameCommittedRef.current = false;
    setRenameEditing(true);
  };

  const commitRename = () => {
    if (renameCommittedRef.current) return;
    renameCommittedRef.current = true;
    setRenameEditing(false);
    if (!onRename) return;
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === pipelineName) return;
    onRename(trimmed);
  };

  const cancelRename = () => {
    if (renameCommittedRef.current) return;
    renameCommittedRef.current = true;
    setRenameEditing(false);
  };

  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  // Query pending deploy requests for this pipeline
  const pendingRequestsQuery = useQuery({
    ...trpc.release.direct.listPendingRequests.queryOptions({ pipelineId: pipelineId! }),
    enabled: !!pipelineId,
  });
  const pendingRequest = (pendingRequestsQuery.data ?? [])[0];
  const isMyRequest = pendingRequest?.requestedById === session?.user?.id;

  const cancelRequestMutation = useMutation(
    trpc.release.direct.cancelDeployRequest.mutationOptions({
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
      // Stage the import and show a diff vs the current graph; the user applies
      // it explicitly (below) so an import never silently replaces their work.
      const diff = diffImportedGraph(
        { nodes: newNodes, edges: newEdges, globalConfig: importedGlobalConfig },
        { nodes, edges, globalConfig },
      );
      setPendingImport({
        nodes: newNodes,
        edges: newEdges,
        globalConfig: importedGlobalConfig,
        sourceName,
      });
      setImportDiff(diff);
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
    } catch (err) {
      setPendingImport(null);
      setImportDiff(null);
      setImportWarnings([]);
      setImportValidation({ status: "idle" });
      toast.error("Import failed", { description: String(err), duration: 6000 });
    }
  };

  const applyPendingImport = () => {
    if (!pendingImport) return;
    loadGraph(pendingImport.nodes, pendingImport.edges, pendingImport.globalConfig);
    toast.success(
      `Imported ${pendingImport.nodes.length} components from ${pendingImport.sourceName}`,
    );
    setPendingImport(null);
    setImportDiff(null);
    setImportOpen(false);
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
  const handleDeleteSelected = () => {
    if (selectedNodeId) removeNode(selectedNodeId);
    else if (selectedEdgeId) removeEdge(selectedEdgeId);
  };

  const processDotVariant = processStatus ? PROCESS_STATUS_DOT[processStatus] : null;
  const processLabel = processStatus ? PROCESS_STATUS_LABEL[processStatus] : null;
  const collapseTierTwo = useMediaQuery("(max-width: 1279px)");
  const collapseTierThree = useMediaQuery("(max-width: 1023px)");
  const showOverflowMenu = collapseTierTwo || collapseTierThree;
  const showInlineViewActions = !collapseTierThree;
  const showInlineToolsActions = !collapseTierThree;
  const canDeleteSelected = !!selectedNodeId || !!selectedEdgeId;
  const showPipelineMeta = !!(pipelineName || environmentName || deployedVersionNumber != null);

  return (
    <TooltipProvider>
      <div className="flex h-11 min-w-0 items-center gap-2 px-3">
        <div data-testid="pipeline-toolbar-identity" className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {/* Process status dot — first element, before pipeline name */}
          {processStatus && processDotVariant && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0 items-center">
                  <StatusDot
                    variant={processDotVariant}
                    pulse={processStatus === "RUNNING"}
                    halo={processStatus === "RUNNING"}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {processLabel}{nodeCount != null && ` · ${nodeCount} node${nodeCount === 1 ? "" : "s"}`}
              </TooltipContent>
            </Tooltip>
          )}
          {showPipelineMeta && (
            <div className="flex min-w-0 items-center gap-1.5">
              {pipelineName && (
                renameEditing && onRename ? (
                  <input
                    aria-label="Pipeline name"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    disabled={isRenaming}
                    autoFocus
                    className="w-40 max-w-full border-b border-line-2 bg-transparent font-mono text-[13px] font-medium text-fg outline-none focus:border-accent-brand xl:w-52"
                  />
                ) : onRename ? (
                  <button
                    type="button"
                    onClick={startRename}
                    title="Click to rename"
                    className="max-w-[240px] rounded-[3px] px-1 font-mono text-[13px] font-medium text-fg transition-colors hover:bg-bg-3 xl:max-w-[320px]"
                  >
                    <span className="block truncate">{pipelineName}</span>
                  </button>
                ) : (
                  <span className="block max-w-[240px] truncate font-mono text-[13px] font-medium text-fg xl:max-w-[320px]">
                    {pipelineName}
                  </span>
                )
              )}
              {deployedVersionNumber != null && (
                <span className="font-mono text-[11px] text-fg-2">
                  v{deployedVersionNumber}
                </span>
              )}
              {/* Validation status badge */}
              {validationErrorCount > 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 rounded-[3px] border border-status-error/35 bg-status-error/10 px-1.5 py-0.5 font-mono text-[10px] text-status-error">
                      <AlertTriangle className="h-3 w-3" />
                      {validationErrorCount}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{validationMessage ?? "Fix validation errors before deploying"}</TooltipContent>
                </Tooltip>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-[3px] border border-status-healthy/30 bg-status-healthy/10 px-1.5 py-0.5 font-mono text-[10px] text-status-healthy">
                  <CircleCheck className="h-3 w-3" />
                </span>
              )}
            </div>
          )}

          {gitOpsMode === "bidirectional" && (
            <div className="flex shrink-0 items-center gap-1.5 rounded-[3px] border border-line-2 bg-bg-2 px-2 py-1 font-mono text-[11px] text-fg-1">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden lg:inline">GitOps managed — changes may be overwritten on next git push</span>
              <span className="lg:hidden">GitOps managed</span>
            </div>
          )}

          {gitOpsMode === "bidirectional" && (
            <Separator orientation="vertical" className="mx-1 h-[18px] bg-line-2" />
          )}
        </div>

        <div data-testid="pipeline-toolbar-actions" className="flex shrink-0 items-center gap-2 border-l border-line pl-2">

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onSave} disabled={isSaving || !isDirty} className={cn("relative", !isDirty && "opacity-50")} aria-label="Save pipeline">
                <Save className="h-4 w-4" />
                {isDirty && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-status-degraded" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Save pipeline (Cmd+S)</TooltipContent>
          </Tooltip>

          {!collapseTierTwo && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={handleValidate} disabled={validateWithToastMutation.isPending} aria-label="Validate pipeline">
                  <CheckCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Validate pipeline</TooltipContent>
            </Tooltip>
          )}

          <Separator orientation="vertical" className="mx-1 h-[18px] bg-line-2" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={undo} disabled={!canUndo} aria-label="Undo">
                <Undo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (Cmd+Z)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={redo} disabled={!canRedo} aria-label="Redo">
                <Redo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (Cmd+Shift+Z)</TooltipContent>
          </Tooltip>

          {!collapseTierTwo && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleDeleteSelected}
                    disabled={!canDeleteSelected}
                    className="text-fg-2 hover:text-status-error"
                    aria-label="Delete selected"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete selected (Del)</TooltipContent>
              </Tooltip>

            </>
          )}


          {showInlineViewActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="relative h-7 gap-1.5 px-2 text-[11px]" aria-label="View actions">
                  <Eye className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">View</span>
                  <ChevronDown className="h-3 w-3 text-fg-2" />
                  {hasRecentErrors && !logsOpen && (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-status-error" />
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
                    <span className="ml-auto h-2 w-2 rounded-full bg-status-error" />
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
                    <DropdownMenuItem onClick={() => setVersionsOpen(true)}>
                      <History className="mr-2 h-4 w-4" />
                      Version history
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}


          {showInlineToolsActions && (
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
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Import / Export</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setImportOpen(true)}>
                  <Upload className="mr-2 h-4 w-4" />
                  Import config
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportYaml}>
                  <FileDown className="mr-2 h-4 w-4" />
                  Download YAML
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportToml}>
                  <FileDown className="mr-2 h-4 w-4" />
                  Download TOML
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onSaveAsTemplate} disabled={nodes.length === 0}>
                  <BookTemplate className="mr-2 h-4 w-4" />
                  Save as template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <ToolbarMenuButton icon={Settings} label="Settings" />
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>Pipeline settings</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-80">
              <PipelineSettings pipelineId={pipelineId} />
            </PopoverContent>
          </Popover>

          {showOverflowMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>More actions</DropdownMenuLabel>
                {collapseTierTwo && (
                  <>
                    <DropdownMenuItem onClick={handleValidate} disabled={validateWithToastMutation.isPending}>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Validate pipeline
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDeleteSelected} disabled={!canDeleteSelected}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete selected
                    </DropdownMenuItem>
                  </>
                )}
                {collapseTierThree && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onToggleMetrics} disabled={!onToggleMetrics}>
                      <BarChart3 className="mr-2 h-4 w-4" />
                      {metricsOpen ? "Hide metrics" : "Show metrics"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onToggleLogs} disabled={!onToggleLogs}>
                      <ScrollText className="mr-2 h-4 w-4" />
                      {logsOpen ? "Hide logs" : "Show logs"}
                    </DropdownMenuItem>
                    {pipelineId && (
                      <>
                        <DropdownMenuItem asChild>
                          <Link href={`/pipelines/${pipelineId}/scorecard`}>
                            <Gauge className="mr-2 h-4 w-4" />
                            Pipeline scorecard
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setVersionsOpen(true)}>
                          <History className="mr-2 h-4 w-4" />
                          Version history
                        </DropdownMenuItem>
                      </>
                    )}
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
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Import / Export</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => setImportOpen(true)}>
                      <Upload className="mr-2 h-4 w-4" />
                      Import config
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportYaml}>
                      <FileDown className="mr-2 h-4 w-4" />
                      Download YAML
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportToml}>
                      <FileDown className="mr-2 h-4 w-4" />
                      Download TOML
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onSaveAsTemplate} disabled={nodes.length === 0}>
                      <BookTemplate className="mr-2 h-4 w-4" />
                      Save as template
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

          <Dialog
            open={importOpen}
            onOpenChange={(open) => {
              setImportOpen(open);
              if (!open) {
                setPendingImport(null);
                setImportDiff(null);
              }
            }}
          >
            <DialogContent className="sm:max-w-[460px]">
              <DialogHeader>
                <DialogTitle>Import Vector config</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">Paste YAML/TOML or upload a config file.</div>
                <Textarea
                  aria-label="Vector config"
                  value={importText}
                  onChange={(e) => {
                    setImportText(e.target.value);
                    // The staged preview no longer matches edited text.
                    setPendingImport(null);
                    setImportDiff(null);
                  }}
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
                      Preview TOML
                    </Button>
                    <Button type="button" size="sm" onClick={() => handlePasteImport("yaml")} disabled={!importText.trim()}>
                      Preview YAML
                    </Button>
                  </div>
                </div>
                {importDiff && (
                  <div className="rounded-md border border-line-2 bg-bg-2 p-2 text-xs">
                    <div className="mb-1 font-medium">Changes vs current pipeline</div>
                    <div className="mb-1.5 flex flex-wrap gap-2">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{importDiff.components.filter((c) => c.status === "added").length} added
                      </span>
                      <span className="text-amber-600 dark:text-amber-400">
                        ~{importDiff.components.filter((c) => c.status === "changed").length} changed
                      </span>
                      <span className="text-red-600 dark:text-red-400">
                        −{importDiff.components.filter((c) => c.status === "removed").length} removed
                      </span>
                      <span className="text-muted-foreground">{importDiff.unchanged} unchanged</span>
                      {(importDiff.edgesAdded > 0 || importDiff.edgesRemoved > 0) && (
                        <span className="text-muted-foreground">
                          edges +{importDiff.edgesAdded}/−{importDiff.edgesRemoved}
                        </span>
                      )}
                      {importDiff.globalConfigChanged && (
                        <span className="text-amber-600 dark:text-amber-400">
                          global config changed
                        </span>
                      )}
                    </div>
                    {importDiff.components.length > 0 && (
                      <ul className="max-h-32 space-y-0.5 overflow-y-auto font-mono">
                        {importDiff.components.map((c) => (
                          <li key={`${c.status}-${c.componentKey}`}>
                            <span
                              className={cn(
                                c.status === "added" && "text-emerald-600 dark:text-emerald-400",
                                c.status === "changed" && "text-amber-600 dark:text-amber-400",
                                c.status === "removed" && "text-red-600 dark:text-red-400",
                              )}
                            >
                              {c.status === "added" ? "+" : c.status === "removed" ? "−" : "~"}
                            </span>{" "}
                            {c.componentKey} <span className="text-muted-foreground">({c.type})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
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
                {pendingImport && (
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPendingImport(null);
                        setImportDiff(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="button" size="sm" onClick={applyPendingImport}>
                      Apply import
                    </Button>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>


          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml,.toml"
            className="hidden"
            onChange={handleFileSelected}
          />

          {pipelineId && (
            <VersionHistoryDialog
              pipelineId={pipelineId}
              open={versionsOpen}
              onOpenChange={setVersionsOpen}
            />
          )}

          <KeyboardShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
          />

        <div className="flex shrink-0 items-center gap-2 border-l border-line pl-2">
          {/* Pending approval indicator */}
          {pendingRequest && (
            <div className="flex items-center gap-0.5 px-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-status-degraded">
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
                      size="icon-xs"
                      onClick={() => cancelRequestMutation.mutate({ requestId: pendingRequest.id })}
                      disabled={cancelRequestMutation.isPending}
                      className="text-fg-2 hover:text-status-error"
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

          {lastSavedLabel && (
            <span className="font-mono text-[10px] text-fg-2">
              last saved {lastSavedLabel}
            </span>
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
                        variant="primary"
                        size="sm"
                        onClick={onDeploy}
                        disabled={nodes.length === 0 || validationErrorCount > 0 || isSaving}
                        className="gap-1.5"
                      >
                        <Rocket className="h-3.5 w-3.5" />
                        Deploy
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{validationErrorCount > 0 ? (validationMessage ?? "Fix validation errors before deploying") : "Deploy pipeline to environment"}</TooltipContent>
                  </Tooltip>
                </PressableScale>
              );
            }

            if (hasChanges) {
              // Deployed but has changes to deploy
              return (
                <>
                  {onDiscardChanges && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={onDiscardChanges}
                          className="gap-1.5"
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
                        className="gap-1.5 text-status-error hover:text-status-error"
                      >
                        <CircleX className="h-3.5 w-3.5" />
                        Undeploy
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Remove deployed config</TooltipContent>
                  </Tooltip>
                  <PressableScale>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={onDeploy}
                          disabled={nodes.length === 0 || validationErrorCount > 0 || isSaving}
                          className="gap-1.5"
                        >
                          <Rocket className="h-3.5 w-3.5" />
                          Deploy
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{validationErrorCount > 0 ? (validationMessage ?? "Fix validation errors before deploying") : `Changes detected${deployedVersionNumber != null ? ` since v${deployedVersionNumber}` : ''} — deploy to update`}</TooltipContent>
                    </Tooltip>
                  </PressableScale>
                </>
              );
            }

            // Deployed and up-to-date — no redeploy needed
            return (
              <>
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-status-healthy">
                  <CircleCheck className="h-3.5 w-3.5" />
                  Deployed{deployedVersionNumber != null ? ` v${deployedVersionNumber}` : ''}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onUndeploy}
                      className="gap-1.5 text-status-error hover:text-status-error"
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
