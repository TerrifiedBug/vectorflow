"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { toast } from "sonner";
import { Sparkles, Loader2, CheckCircle, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { QueryError } from "@/components/query-error";

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; placeholder: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", placeholder: "gpt-4o" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", placeholder: "claude-sonnet-4-20250514" },
  custom: { baseUrl: "", placeholder: "model-name" },
};

interface AiConfig {
  aiEnabled: boolean;
  aiProvider: string | null;
  aiBaseUrl: string | null;
  aiModel: string | null;
  hasApiKey: boolean;
}

function AiSettingsForm({ config, teamId }: { config: AiConfig; teamId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [provider, setProvider] = useState(config.aiProvider ?? "openai");
  const [baseUrl, setBaseUrl] = useState(config.aiBaseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(config.aiModel ?? "");
  const [enabled, setEnabled] = useState(config.aiEnabled);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const updateMutation = useMutation(
    trpc.team.updateAiConfig.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.team.getAiConfig.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.team.get.queryKey() });
        toast.success("AI configuration saved");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save AI config");
      },
    }),
  );

  const testMutation = useMutation(
    trpc.team.testAiConnection.mutationOptions({
      onSuccess: (result) => {
        setTestResult(result);
        if (result.ok) {
          toast.success("AI connection successful!");
        } else {
          toast.error("Connection failed", { description: result.error });
        }
      },
      onError: (error) => {
        setTestResult({ ok: false, error: error.message });
        toast.error("Connection test failed", { description: error.message });
      },
    }),
  );

  const handleSave = () => {
    const data: Record<string, unknown> = {
      teamId,
      aiEnabled: enabled,
      aiProvider: provider as "openai" | "anthropic" | "custom",
      aiBaseUrl: baseUrl || null,
      aiModel: model || null,
    };
    if (apiKey) {
      data.aiApiKey = apiKey;
    }
    updateMutation.mutate(data as Parameters<typeof updateMutation.mutate>[0]);
  };

  const handleTest = () => {
    setTestResult(null);
    testMutation.mutate({ teamId });
  };

  const handleProviderChange = (value: string) => {
    setProvider(value);
    const defaults = PROVIDER_DEFAULTS[value];
    if (defaults) {
      setBaseUrl(defaults.baseUrl);
    }
    setTestResult(null);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI-Powered Suggestions
          </CardTitle>
          <CardDescription>
            Configure an OpenAI-compatible AI provider for VRL code assistance and
            pipeline generation. Credentials are encrypted at rest and scoped to this team.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable AI Suggestions</Label>
              <p className="text-xs text-muted-foreground">
                When enabled, team members with Editor+ role can use AI assistance in the
                VRL editor and pipeline builder.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          {/* Provider Selection */}
          <div className="space-y-2">
            <Label htmlFor="ai-provider">Provider</Label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger id="ai-provider" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="custom">Custom (OpenAI-compatible)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <Label htmlFor="ai-base-url">Base URL</Label>
            <Input
              id="ai-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={PROVIDER_DEFAULTS[provider]?.baseUrl || "https://api.example.com/v1"}
            />
            <p className="text-xs text-muted-foreground">
              OpenAI-compatible API endpoint. Pre-filled for known providers.
            </p>
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <Label htmlFor="ai-api-key">API Key</Label>
            <Input
              id="ai-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config.hasApiKey ? "••••••••••• (saved)" : "sk-..."}
            />
            <p className="text-xs text-muted-foreground">
              {config.hasApiKey
                ? "A key is already saved. Enter a new value to replace it."
                : "Encrypted at rest using AES-256."}
            </p>
          </div>

          {/* Model */}
          <div className="space-y-2">
            <Label htmlFor="ai-model">Model</Label>
            <Input
              id="ai-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={PROVIDER_DEFAULTS[provider]?.placeholder || "model-name"}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testMutation.isPending || (!config.hasApiKey && !apiKey)}
            >
              {testMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </Button>
            {testResult && (
              <Badge
                variant={testResult.ok ? "outline" : "destructive"}
                className={testResult.ok ? "text-green-600 border-green-600" : ""}
              >
                {testResult.ok ? (
                  <><CheckCircle className="mr-1 h-3 w-3" /> Connected</>
                ) : (
                  <><XCircle className="mr-1 h-3 w-3" /> Failed</>
                )}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function AiSettings() {
  const trpc = useTRPC();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const configQuery = useQuery(
    trpc.team.getAiConfig.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );

  if (configQuery.isError) return <QueryError message="Failed to load AI settings" onRetry={() => configQuery.refetch()} />;

  if (configQuery.isLoading || !configQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return <AiSettingsForm config={configQuery.data} teamId={selectedTeamId!} />;
}
