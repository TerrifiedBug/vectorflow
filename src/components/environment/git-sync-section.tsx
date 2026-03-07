"use client";

import { useState } from "react";
import { useTRPC } from "@/trpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GitBranch, Eye, EyeOff, Loader2, Copy, Info } from "lucide-react";

import { copyToClipboard } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface GitSyncSectionProps {
  environmentId: string;
  gitRepoUrl: string | null;
  gitBranch: string | null;
  hasGitToken: boolean;
  gitOpsMode?: string;
  hasWebhookSecret?: boolean;
}

export function GitSyncSection({
  environmentId,
  gitRepoUrl,
  gitBranch,
  hasGitToken,
  gitOpsMode = "off",
  hasWebhookSecret = false,
}: GitSyncSectionProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [repoUrl, setRepoUrl] = useState(gitRepoUrl ?? "");
  const [branch, setBranch] = useState(gitBranch ?? "main");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [selectedGitOpsMode, setSelectedGitOpsMode] = useState(gitOpsMode);
  // The actual webhook secret is only available from the update mutation response
  const [webhookSecretFromMutation, setWebhookSecretFromMutation] = useState<string | null>(null);

  const updateMutation = useMutation(
    trpc.environment.update.mutationOptions({
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: trpc.environment.get.queryKey({ id: environmentId }) });
        // Capture the webhook secret from the EDITOR-gated mutation response
        if (data.gitWebhookSecret) {
          setWebhookSecretFromMutation(data.gitWebhookSecret);
        } else {
          setWebhookSecretFromMutation(null);
        }
      },
      onError: (err) => toast.error(err.message || "Failed to save Git settings"),
    })
  );

  const testMutation = useMutation(
    trpc.environment.testGitConnection.mutationOptions({
      onSuccess: (result) => {
        if (result.success) {
          toast.success("Git connection successful");
        } else {
          toast.error("Git connection failed", { description: result.error });
        }
        setIsTesting(false);
      },
      onError: (err) => {
        toast.error("Connection test failed", { description: err.message });
        setIsTesting(false);
      },
    })
  );

  function handleSave() {
    updateMutation.mutate(
      {
        id: environmentId,
        gitRepoUrl: repoUrl || null,
        gitBranch: branch || null,
        gitToken: token || undefined, // Only send if user entered a new token
        gitOpsMode: selectedGitOpsMode as "off" | "push" | "bidirectional",
      },
      {
        onSuccess: () => {
          toast.success("Git integration settings saved");
          setToken("");
        },
      },
    );
  }

  function handleTest() {
    if (!repoUrl) {
      toast.error("Enter a repository URL first");
      return;
    }
    if (!token && !hasGitToken) {
      toast.error("Enter an access token first");
      return;
    }
    setIsTesting(true);
    testMutation.mutate({
      environmentId,
      repoUrl,
      branch,
      ...(token ? { token } : {}),
    });
  }

  function handleDisconnect() {
    updateMutation.mutate(
      {
        id: environmentId,
        gitRepoUrl: null,
        gitBranch: null,
        gitToken: null,
        gitOpsMode: "off",
      },
      {
        onSuccess: () => {
          toast.success("Git integration disconnected");
          setRepoUrl("");
          setBranch("main");
          setToken("");
          setSelectedGitOpsMode("off");
        },
      },
    );
  }

  const hasChanges =
    repoUrl !== (gitRepoUrl ?? "") ||
    branch !== (gitBranch ?? "main") ||
    token !== "" ||
    selectedGitOpsMode !== gitOpsMode;
  const isConfigured = !!gitRepoUrl;

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhooks/git`
      : "/api/webhooks/git";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          <div>
            <CardTitle>Git Integration</CardTitle>
            <CardDescription>
              Automatically commit pipeline YAML to a Git repository on deploy and delete.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="git-repo-url">Repository URL</Label>
          <Input
            id="git-repo-url"
            type="url"
            placeholder="https://github.com/org/pipeline-configs.git"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="git-branch">Branch</Label>
          <Input
            id="git-branch"
            placeholder="main"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="git-token">
            Access Token {hasGitToken && "(saved \u2014 enter new value to replace)"}
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="git-token"
                type={showToken ? "text" : "password"}
                placeholder={hasGitToken ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "ghp_xxxx or glpat-xxxx"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        {/* GitOps Mode */}
        <div className="space-y-2">
          <Label htmlFor="gitops-mode">GitOps Mode</Label>
          <Select
            value={selectedGitOpsMode}
            onValueChange={setSelectedGitOpsMode}
          >
            <SelectTrigger id="gitops-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="push">Push Only (deploy commits YAML to repo)</SelectItem>
              <SelectItem value="bidirectional">Bi-directional (push + git webhooks import changes)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {selectedGitOpsMode === "off" && "Git sync is disabled."}
            {selectedGitOpsMode === "push" && "Pipeline YAML is committed to the repo on deploy. Changes in git are not pulled back."}
            {selectedGitOpsMode === "bidirectional" && "Pipeline YAML is committed on deploy AND pushes to the repo trigger pipeline imports via webhook."}
          </p>
        </div>

        {/* Webhook configuration for bidirectional mode */}
        {selectedGitOpsMode === "bidirectional" && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Info className="h-4 w-4 text-blue-500" />
              Webhook Configuration
            </div>
            <p className="text-xs text-muted-foreground">
              Configure a webhook in your GitHub repository settings to enable bi-directional sync.
              Set the content type to <code className="rounded bg-muted px-1">application/json</code> and
              select the <strong>push</strong> event.
            </p>

            <div className="space-y-2">
              <Label>Webhook URL</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy webhook URL"
                  onClick={async () => {
                    await copyToClipboard(webhookUrl);
                    toast.success("Webhook URL copied");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {webhookSecretFromMutation && (
              <div className="space-y-2">
                <Label>Webhook Secret</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={webhookSecretFromMutation} className="font-mono text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copy webhook secret"
                    onClick={async () => {
                      await copyToClipboard(webhookSecretFromMutation);
                      toast.success("Webhook secret copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste this secret into your GitHub webhook settings to enable HMAC signature verification.
                </p>
              </div>
            )}
            {!webhookSecretFromMutation && hasWebhookSecret && (
              <p className="text-xs text-muted-foreground">
                Webhook secret is configured. Save settings again to reveal the secret.
              </p>
            )}
            {!webhookSecretFromMutation && !hasWebhookSecret && (
              <p className="text-xs text-muted-foreground">
                Save settings to generate a webhook secret.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending || !hasChanges}
          >
            {updateMutation.isPending ? "Saving..." : "Save"}
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={isTesting || !repoUrl}
          >
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Testing...
              </>
            ) : (
              "Test Connection"
            )}
          </Button>
          {isConfigured && (
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={updateMutation.isPending}
            >
              Disconnect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
