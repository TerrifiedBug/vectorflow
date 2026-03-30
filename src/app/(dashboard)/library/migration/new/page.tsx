"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  FileText,
  CheckCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type WizardStep = "platform" | "config" | "parse" | "review";

interface ParseResult {
  readinessScore: number;
  complexity: {
    totalBlocks: number;
    uniquePlugins: string[];
    rubyExpressionCount: number;
    routingBranches: number;
  };
}

export default function NewMigrationPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const [step, setStep] = useState<WizardStep>("platform");
  const [platform] = useState<"FLUENTD">("FLUENTD");
  const [name, setName] = useState("");
  const [configText, setConfigText] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);

  const createMutation = useMutation(
    trpc.migration.create.mutationOptions(),
  );

  const parseMutation = useMutation(
    trpc.migration.parse.mutationOptions(),
  );

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setConfigText(text);
      };
      reader.readAsText(file);
    },
    [],
  );

  const handleCreateAndParse = async () => {
    if (!selectedTeamId || !name.trim() || !configText.trim()) {
      toast.error("Please provide a name and config.");
      return;
    }

    try {
      // Create the project
      const project = await createMutation.mutateAsync({
        teamId: selectedTeamId,
        name: name.trim(),
        platform,
        originalConfig: configText,
      });

      setProjectId(project.id);

      // Parse the config
      const result = await parseMutation.mutateAsync({
        id: project.id,
        teamId: selectedTeamId,
      });

      setParseResult({
        readinessScore: result.readinessScore ?? 0,
        complexity: (result.parsedTopology as { complexity: ParseResult["complexity"] })?.complexity ?? {
          totalBlocks: 0,
          uniquePlugins: [],
          rubyExpressionCount: 0,
          routingBranches: 0,
        },
      });

      setStep("review");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create project",
      );
    }
  };

  const handleFinish = () => {
    if (projectId) {
      router.push(`/library/migration/${projectId}`);
    }
  };

  const isCreating = createMutation.isPending || parseMutation.isPending;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/library/migration")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
      </div>

      <h1 className="text-2xl font-bold">New Migration Project</h1>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(["platform", "config", "review"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && (
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Badge
              variant={
                step === s
                  ? "default"
                  : ["platform", "config", "review"].indexOf(step) > i
                    ? "secondary"
                    : "outline"
              }
            >
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </Badge>
          </div>
        ))}
      </div>

      {/* Step 1: Platform */}
      {step === "platform" && (
        <Card>
          <CardHeader>
            <CardTitle>Select Platform</CardTitle>
            <CardDescription>
              Choose the log pipeline platform you are migrating from.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Card
              className="cursor-pointer border-primary bg-primary/5"
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  FluentD
                </CardTitle>
                <CardDescription className="text-xs">
                  Full support for FluentD config parsing and AI translation
                </CardDescription>
              </CardHeader>
            </Card>

            <div className="space-y-2">
              <Label htmlFor="name">Project Name</Label>
              <Input
                id="name"
                placeholder="e.g., Production FluentD Migration"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <Button
              onClick={() => setStep("config")}
              disabled={!name.trim()}
            >
              Next
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Upload Config */}
      {step === "config" && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Configuration</CardTitle>
            <CardDescription>
              Upload or paste your FluentD configuration file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file">Upload file</Label>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="file"
                  className="flex items-center gap-2 px-4 py-2 border rounded-md cursor-pointer hover:bg-accent transition-colors"
                >
                  <Upload className="h-4 w-4" />
                  Choose file
                </label>
                <input
                  id="file"
                  type="file"
                  accept=".conf,.cfg,.config,.txt"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                {configText && (
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    Config loaded ({configText.split("\n").length} lines)
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="config">Or paste config</Label>
              <Textarea
                id="config"
                placeholder={`<source>
  @type tail
  path /var/log/nginx/access.log
  tag nginx.access
  <parse>
    @type json
  </parse>
</source>

<match nginx.**>
  @type elasticsearch
  host es-host
  port 9200
</match>`}
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                className="font-mono text-sm min-h-[300px]"
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("platform")}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <Button
                onClick={handleCreateAndParse}
                disabled={!configText.trim() || isCreating}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    Analyze Config
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Review */}
      {step === "review" && parseResult && (
        <Card>
          <CardHeader>
            <CardTitle>Analysis Complete</CardTitle>
            <CardDescription>
              Review the analysis results before proceeding.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Readiness Score */}
            <div className="flex items-center gap-3 p-4 border rounded-lg">
              <div className="text-3xl font-bold">
                {parseResult.readinessScore}%
              </div>
              <div>
                <div className="font-medium">Readiness Score</div>
                <div className="text-sm text-muted-foreground">
                  {parseResult.readinessScore >= 70
                    ? "Strong candidate for automated migration"
                    : parseResult.readinessScore >= 40
                      ? "Partial auto-migration with manual adjustments"
                      : "Significant manual work required"}
                </div>
              </div>
            </div>

            {/* Complexity Summary */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 border rounded-lg">
                <div className="text-sm text-muted-foreground">Blocks</div>
                <div className="text-xl font-semibold">
                  {parseResult.complexity.totalBlocks}
                </div>
              </div>
              <div className="p-3 border rounded-lg">
                <div className="text-sm text-muted-foreground">Plugins</div>
                <div className="text-xl font-semibold">
                  {parseResult.complexity.uniquePlugins.length}
                </div>
              </div>
              <div className="p-3 border rounded-lg">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  Ruby Expressions
                  {parseResult.complexity.rubyExpressionCount > 0 && (
                    <AlertTriangle className="h-3 w-3 text-yellow-500" />
                  )}
                </div>
                <div className="text-xl font-semibold">
                  {parseResult.complexity.rubyExpressionCount}
                </div>
              </div>
              <div className="p-3 border rounded-lg">
                <div className="text-sm text-muted-foreground">
                  Routing Branches
                </div>
                <div className="text-xl font-semibold">
                  {parseResult.complexity.routingBranches}
                </div>
              </div>
            </div>

            {/* Plugins */}
            <div>
              <div className="text-sm font-medium mb-2">Detected Plugins</div>
              <div className="flex flex-wrap gap-1">
                {parseResult.complexity.uniquePlugins.map((plugin) => (
                  <Badge key={plugin} variant="outline">
                    {plugin}
                  </Badge>
                ))}
              </div>
            </div>

            <Button onClick={handleFinish} className="w-full">
              Open Project
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
