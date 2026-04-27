"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { copyToClipboard } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  KeyRound,
  Copy,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DemoDisabledBadge, DemoDisabledFieldset } from "@/components/demo-disabled";

// ─── SCIM Provisioning Section ──────────────────────────────────────────────

export function ScimSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery(trpc.settings.get.queryOptions());
  const settings = settingsQuery.data;

  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [generatedToken, setGeneratedToken] = useState("");
  const [copied, setCopied] = useState(false);

  const updateScimMutation = useMutation(
    trpc.settings.updateScim.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("SCIM settings updated");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update SCIM settings", { duration: 6000 });
      },
    })
  );

  const generateTokenMutation = useMutation(
    trpc.settings.generateScimToken.mutationOptions({
      onSuccess: (data) => {
        setGeneratedToken(data.token);
        setTokenDialogOpen(true);
        setCopied(false);
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to generate SCIM token", { duration: 6000 });
      },
    })
  );

  const handleCopyToken = async () => {
    await copyToClipboard(generatedToken);
    setCopied(true);
    toast.success("Token copied to clipboard");
  };

  const scimBaseUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/scim/v2`
    : "/api/scim/v2";

  if (settingsQuery.isError) return <QueryError message="Failed to load SCIM settings" onRetry={() => settingsQuery.refetch()} />;

  if (settingsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                SCIM Provisioning
                <DemoDisabledBadge />
              </CardTitle>
              <CardDescription>
                Enable SCIM 2.0 to automatically provision and deprovision users
                from your identity provider (Okta, Entra ID, etc.).
              </CardDescription>
            </div>
            <StatusBadge variant={settings?.scimEnabled ? "healthy" : "neutral"}>
              {settings?.scimEnabled ? "Enabled" : "Disabled"}
            </StatusBadge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
         <DemoDisabledFieldset message="SCIM provisioning is disabled in the public demo. The toggle, base URL, and token generator below cannot be used.">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable SCIM</Label>
              <p className="text-xs text-muted-foreground">
                Allow your identity provider to manage users and groups via SCIM 2.0
              </p>
            </div>
            <Switch
              checked={settings?.scimEnabled ?? false}
              onCheckedChange={(checked) => updateScimMutation.mutate({ enabled: checked })}
              disabled={updateScimMutation.isPending}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>SCIM Base URL</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded border bg-muted px-3 py-2 text-sm font-mono">
                {scimBaseUrl}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  copyToClipboard(scimBaseUrl);
                  toast.success("URL copied to clipboard");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter this URL in your identity provider&apos;s SCIM configuration
            </p>
          </div>

          <div className="space-y-2">
            <Label>Bearer Token</Label>
            <div className="flex items-center gap-3">
              <Badge variant={settings?.scimTokenConfigured ? "secondary" : "outline"} className="text-xs">
                {settings?.scimTokenConfigured ? (
                  <>
                    <KeyRound className="mr-1 h-3 w-3" />
                    Token configured
                  </>
                ) : (
                  "No token configured"
                )}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => generateTokenMutation.mutate()}
                disabled={generateTokenMutation.isPending}
              >
                {generateTokenMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-2 h-4 w-4" />
                    {settings?.scimTokenConfigured ? "Regenerate Token" : "Generate Token"}
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {settings?.scimTokenConfigured
                ? "Generating a new token will invalidate the previous one. Update your identity provider after regenerating."
                : "Generate a bearer token and configure it in your identity provider."}
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Identity Provider Setup</Label>
            <div className="rounded border bg-muted/50 p-4 text-sm space-y-3">
              <p className="font-medium">Quick setup instructions:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>In your IdP (Okta, Entra ID, etc.), navigate to SCIM provisioning settings</li>
                <li>Set the SCIM connector base URL to the URL shown above</li>
                <li>Set the authentication mode to &quot;HTTP Header&quot; / &quot;Bearer Token&quot;</li>
                <li>Paste the generated bearer token</li>
                <li>Enable provisioning actions: Create Users, Update User Attributes, Deactivate Users</li>
                <li>Test the connection from your IdP and assign users/groups</li>
              </ol>
            </div>
          </div>
         </DemoDisabledFieldset>
        </CardContent>
      </Card>

      {/* Token display dialog -- shown once after generation */}
      <Dialog open={tokenDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setGeneratedToken("");
          setCopied(false);
        }
        setTokenDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>SCIM Bearer Token Generated</DialogTitle>
            <DialogDescription>
              Copy this token now. It will not be shown again. Configure it in
              your identity provider&apos;s SCIM settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded border bg-muted px-3 py-2 text-sm font-mono break-all">
                {generatedToken}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyToken}
              >
                {copied ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex items-center gap-2 rounded border border-status-degraded/30 bg-status-degraded-bg p-3 text-sm">
              <AlertTriangle className="h-4 w-4 text-status-degraded-foreground flex-shrink-0" />
              <span className="text-status-degraded-foreground">
                This token will not be shown again. Make sure to save it before closing this dialog.
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setTokenDialogOpen(false);
                setGeneratedToken("");
                setCopied(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
