"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import Dagre from "@dagrejs/dagre";
import {
  Upload,
  FileText,
  ArrowRight,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { parseVectorConfig, detectSubgraphs } from "@/lib/config-generator";
import type { ParseResult, Subgraph } from "@/lib/config-generator";
import { VectorTopology } from "@/components/migration/vector-topology";
import type { SubgraphInfo } from "@/components/migration/vector-topology";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";
import { useTRPC } from "@/trpc/client";
import { accessibleToast } from "@/lib/accessible-toast";

// ── Constants ────────────────────────────────────────────────────────────────

const SUBGRAPH_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
];

const ACCEPTED_EXTENSIONS = [".yaml", ".yml", ".toml"];

// ── Types ────────────────────────────────────────────────────────────────────

type Step = "upload" | "review" | "importing" | "done";

interface SubgraphSelection {
  subgraph: Subgraph;
  color: string;
  selected: boolean;
  name: string;
}

interface CreatedPipeline {
  id: string;
  name: string;
}

// ── Layout helper ─────────────────────────────────────────────────────────────

const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;

function autoLayoutSubgraph(subgraph: Subgraph): Array<{
  componentKey: string;
  positionX: number;
  positionY: number;
}> {
  const g = new Dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 80, ranksep: 150 });

  for (const comp of subgraph.components) {
    g.setNode(comp.componentKey, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const comp of subgraph.components) {
    for (const input of comp.inputs) {
      if (subgraph.components.some((c) => c.componentKey === input)) {
        g.setEdge(input, comp.componentKey);
      }
    }
  }

  Dagre.layout(g);

  return subgraph.components.map((comp) => {
    const pos = g.node(comp.componentKey);
    return {
      componentKey: comp.componentKey,
      positionX: pos ? pos.x - NODE_WIDTH / 2 : 0,
      positionY: pos ? pos.y - NODE_HEIGHT / 2 : 0,
    };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VectorMigrationPage() {
  const router = useRouter();
  const trpc = useTRPC();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  const [step, setStep] = useState<Step>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [subgraphSelections, setSubgraphSelections] = useState<SubgraphSelection[]>([]);
  const [createdPipelines, setCreatedPipelines] = useState<CreatedPipeline[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File processing ──────────────────────────────────────────────────────

  const processFile = useCallback((file: File) => {
    const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      accessibleToast.error(`Unsupported file type: ${ext}. Upload a .yaml, .yml, or .toml file.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        const result = parseVectorConfig(content);
        const { subgraphs } = detectSubgraphs(result.components, file.name);
        const selections: SubgraphSelection[] = subgraphs.map((sg, i) => ({
          subgraph: sg,
          color: SUBGRAPH_COLORS[i % SUBGRAPH_COLORS.length],
          selected: true,
          name: sg.suggestedName,
        }));
        setParseResult(result);
        setSubgraphSelections(selections);
        setStep("review");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to parse config";
        accessibleToast.error(msg);
      }
    };
    reader.readAsText(file);
  }, []);

  // ── Drag-and-drop ────────────────────────────────────────────────────────

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  // ── Import mutation ───────────────────────────────────────────────────────

  const importMutation = useMutation(
    trpc.pipeline.batchImport.mutationOptions({
      onSuccess: (data) => {
        setCreatedPipelines(data);
        setStep("done");
      },
      onError: (err) => {
        accessibleToast.error(err.message ?? "Import failed");
        setStep("review");
      },
    }),
  );

  const handleImport = useCallback(() => {
    if (!selectedEnvironmentId) {
      accessibleToast.error("No environment selected. Select an environment first.");
      return;
    }
    if (!selectedTeamId) {
      accessibleToast.error("No team selected.");
      return;
    }

    const selected = subgraphSelections.filter((s) => s.selected);
    if (selected.length === 0) {
      accessibleToast.error("Select at least one pipeline to import.");
      return;
    }

    const pipelines = selected.map(({ subgraph, name }) => {
      const positionMap = new Map(
        autoLayoutSubgraph(subgraph).map((p) => [p.componentKey, p]),
      );

      const nodes = subgraph.components.map((comp) => {
        const pos = positionMap.get(comp.componentKey);
        return {
          componentKey: comp.componentKey,
          componentType: comp.componentType,
          kind: comp.kind,
          config: comp.config,
          positionX: pos?.positionX ?? 0,
          positionY: pos?.positionY ?? 0,
        };
      });

      // Build edges from component inputs
      const edgeSeen = new Set<string>();
      const edges: Array<{ sourceNodeId: string; targetNodeId: string }> = [];
      for (const comp of subgraph.components) {
        for (const inputKey of comp.inputs) {
          if (subgraph.components.some((c) => c.componentKey === inputKey)) {
            const key = `${inputKey}:${comp.componentKey}`;
            if (!edgeSeen.has(key)) {
              edgeSeen.add(key);
              edges.push({ sourceNodeId: inputKey, targetNodeId: comp.componentKey });
            }
          }
        }
      }

      return {
        name,
        nodes,
        edges,
        globalConfig: parseResult?.globalConfig ?? null,
      };
    });

    setStep("importing");
    importMutation.mutate({
      environmentId: selectedEnvironmentId,
      pipelines,
    });
  }, [
    selectedEnvironmentId,
    selectedTeamId,
    subgraphSelections,
    parseResult,
    importMutation,
  ]);

  // ── Computed topology data ────────────────────────────────────────────────

  const topologySubgraphs: SubgraphInfo[] = subgraphSelections.map((sel) => ({
    name: sel.name,
    color: sel.color,
    components: sel.subgraph.components,
  }));

  const allComponents = parseResult?.components ?? [];

  const selectedCount = subgraphSelections.filter((s) => s.selected).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Import Vector Config</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload an existing Vector pipeline config to import it into VectorFlow.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {(["upload", "review", "importing", "done"] as Step[]).map((s, i, arr) => (
          <span key={s} className="flex items-center gap-2">
            <span
              className={
                s === step || (s === "importing" && step === "done")
                  ? "text-foreground font-medium"
                  : ""
              }
            >
              {i + 1}.{" "}
              {s === "importing"
                ? "Import"
                : s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
            {i < arr.length - 1 && <ArrowRight className="h-3 w-3" />}
          </span>
        ))}
      </div>

      {/* ── Step 1: Upload ── */}
      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload Config File</CardTitle>
            <CardDescription className="text-xs">
              Supports YAML (.yaml, .yml) and TOML (.toml) Vector config files
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`
                flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg
                p-10 cursor-pointer transition-colors
                ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"}
              `}
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">
                  Drop your config file here or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  .yaml, .yml, .toml
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".yaml,.yml,.toml"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Review ── */}
      {step === "review" && parseResult && (
        <div className="space-y-4">
          {/* Warnings */}
          {parseResult.warnings.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium mb-1">
                  {parseResult.warnings.length} warning
                  {parseResult.warnings.length > 1 ? "s" : ""}
                </p>
                <ul className="text-xs space-y-0.5 list-disc list-inside">
                  {parseResult.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Global config note */}
          {parseResult.globalConfig && (
            <Alert>
              <FileText className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Global config sections (e.g.{" "}
                <span className="font-mono">
                  {Object.keys(parseResult.globalConfig).join(", ")}
                </span>
                ) will be attached to each imported pipeline.
              </AlertDescription>
            </Alert>
          )}

          {/* Topology preview */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Pipeline Topology</CardTitle>
              <CardDescription className="text-xs">
                {allComponents.length} component
                {allComponents.length !== 1 ? "s" : ""} detected across{" "}
                {subgraphSelections.length} pipeline
                {subgraphSelections.length !== 1 ? "s" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VectorTopology
                components={allComponents}
                subgraphs={topologySubgraphs}
              />
            </CardContent>
          </Card>

          {/* Subgraph list */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Pipelines to Import</CardTitle>
              <CardDescription className="text-xs">
                Select pipelines and edit their names before importing
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {subgraphSelections.map((sel, i) => {
                const sources = sel.subgraph.components.filter(
                  (c) => c.kind === "source",
                ).length;
                const transforms = sel.subgraph.components.filter(
                  (c) => c.kind === "transform",
                ).length;
                const sinks = sel.subgraph.components.filter(
                  (c) => c.kind === "sink",
                ).length;

                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 pl-3 rounded-md border"
                    style={{ borderLeftColor: sel.color, borderLeftWidth: 3 }}
                  >
                    <input
                      type="checkbox"
                      checked={sel.selected}
                      onChange={(e) => {
                        setSubgraphSelections((prev) =>
                          prev.map((s, idx) =>
                            idx === i ? { ...s, selected: e.target.checked } : s,
                          ),
                        );
                      }}
                      className="h-4 w-4 rounded"
                    />
                    <div className="flex-1 py-2.5 flex items-center gap-3">
                      <Input
                        value={sel.name}
                        onChange={(e) => {
                          setSubgraphSelections((prev) =>
                            prev.map((s, idx) =>
                              idx === i ? { ...s, name: e.target.value } : s,
                            ),
                          );
                        }}
                        className="h-7 text-sm max-w-[240px]"
                        placeholder="Pipeline name"
                      />
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {sources > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {sources}S
                          </Badge>
                        )}
                        {transforms > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {transforms}T
                          </Badge>
                        )}
                        {sinks > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {sinks}K
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Environment note */}
          {!selectedEnvironmentId && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                No environment selected. Select an environment from the top bar before importing.
              </AlertDescription>
            </Alert>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStep("upload");
                setParseResult(null);
                setSubgraphSelections([]);
              }}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <Button
              size="sm"
              disabled={selectedCount === 0 || !selectedEnvironmentId}
              onClick={handleImport}
            >
              Import {selectedCount} Pipeline{selectedCount !== 1 ? "s" : ""}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Importing ── */}
      {step === "importing" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Importing pipelines…</p>
            <p className="text-xs text-muted-foreground">This may take a moment.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Step 4: Done ── */}
      {step === "done" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Import Complete
              </CardTitle>
              <CardDescription className="text-xs">
                {createdPipelines.length} pipeline
                {createdPipelines.length !== 1 ? "s" : ""} imported successfully
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {createdPipelines.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-1.5 text-sm border-b last:border-0"
                >
                  <span className="font-medium">{p.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => router.push(`/pipeline/${p.id}`)}
                  >
                    Open in Editor
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStep("upload");
                setParseResult(null);
                setSubgraphSelections([]);
                setCreatedPipelines([]);
              }}
            >
              Import Another
            </Button>
            <Button
              size="sm"
              onClick={() => router.push("/pipeline")}
            >
              Go to Pipelines
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
