"use client";

import { useState } from "react";
import { useTRPC } from "@/trpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GitBranch, Eye, EyeOff, Loader2 } from "lucide-react";

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

interface GitSyncSectionProps {
  environmentId: string;
  gitRepoUrl: string | null;
  gitBranch: string | null;
  hasGitToken: boolean;
}

export function GitSyncSection({
  environmentId,
  gitRepoUrl,
  gitBranch,
  hasGitToken,
}: GitSyncSectionProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [repoUrl, setRepoUrl] = useState(gitRepoUrl ?? "");
  const [branch, setBranch] = useState(gitBranch ?? "main");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const updateMutation = useMutation(
    trpc.environment.update.mutationOptions({
      onSuccess: () => {
        toast.success("Git integration settings saved");
        queryClient.invalidateQueries({ queryKey: trpc.environment.get.queryKey({ id: environmentId }) });
        setToken(""); // Clear token input after save
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
    updateMutation.mutate({
      id: environmentId,
      gitRepoUrl: repoUrl || null,
      gitBranch: branch || null,
      gitToken: token || undefined, // Only send if user entered a new token
    });
  }

  function handleTest() {
    const testToken = token || undefined;
    if (!repoUrl) {
      toast.error("Enter a repository URL first");
      return;
    }
    if (!testToken && !hasGitToken) {
      toast.error("Enter an access token first");
      return;
    }
    setIsTesting(true);
    if (testToken) {
      testMutation.mutate({ repoUrl, branch, token: testToken });
    } else {
      toast.warning("Enter a new token to test the connection");
      setIsTesting(false);
    }
  }

  function handleDisconnect() {
    updateMutation.mutate({
      id: environmentId,
      gitRepoUrl: null,
      gitBranch: null,
      gitToken: null,
    });
    setRepoUrl("");
    setBranch("main");
    setToken("");
  }

  const hasChanges = repoUrl !== (gitRepoUrl ?? "") || branch !== (gitBranch ?? "main") || token !== "";
  const isConfigured = !!gitRepoUrl;

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
