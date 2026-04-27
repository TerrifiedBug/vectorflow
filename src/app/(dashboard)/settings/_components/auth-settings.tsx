"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  Plus,
  X,
} from "lucide-react";

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
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DemoDisabledBadge, DemoDisabledFieldset } from "@/components/demo-disabled";

// ─── Auth Tab ──────────────────────────────────────────────────────────────────

export function AuthSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery(trpc.settings.get.queryOptions());
  const settings = settingsQuery.data;

  const hasLoadedRef = useRef(false);
  const [isDirty, setIsDirty] = useState(false);
  const markDirty = useCallback(() => setIsDirty(true), []);

  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [displayName, setDisplayName] = useState("SSO");
  const [tokenAuthMethod, setTokenAuthMethod] = useState<"client_secret_post" | "client_secret_basic">("client_secret_post");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markFieldTouched = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const fieldErrors = {
    issuer: !issuer.trim() ? "Issuer URL is required." : null,
    clientId: !clientId.trim() ? "Client ID is required." : null,
  };

  useEffect(() => {
    if (!settings) return;
    if (hasLoadedRef.current && isDirty) return; // Don't overwrite dirty state on refetch
    hasLoadedRef.current = true;
    setIssuer(settings.oidcIssuer ?? "");
    setClientId(settings.oidcClientId ?? "");
    setDisplayName(settings.oidcDisplayName ?? "SSO");
    setTokenAuthMethod((settings.oidcTokenEndpointAuthMethod as "client_secret_post" | "client_secret_basic") ?? "client_secret_post");
    // Don't populate clientSecret - it's masked
  }, [settings, isDirty]);

  const updateOidcMutation = useMutation(
    // eslint-disable-next-line react-hooks/refs
    trpc.settings.updateOidc.mutationOptions({
      onSuccess: () => {
        setIsDirty(false);
        hasLoadedRef.current = false; // Allow next sync from server
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("OIDC settings saved successfully");
        setClientSecret("");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save OIDC settings", { duration: 6000 });
      },
    })
  );

  const testOidcMutation = useMutation(
    trpc.settings.testOidc.mutationOptions({
      onSuccess: (data) => {
        toast.success(`OIDC connection successful. Issuer: ${data.issuer}`);
      },
      onError: (error) => {
        toast.error(error.message || "OIDC connection test failed", { duration: 6000 });
      },
    })
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientSecret && !settings?.oidcClientSecret) {
      toast.error("Client secret is required", { duration: 6000 });
      return;
    }
    updateOidcMutation.mutate({
      issuer,
      clientId,
      clientSecret: clientSecret || "unchanged",
      displayName,
      tokenEndpointAuthMethod: tokenAuthMethod,
    });
  };

  const handleTest = () => {
    if (!issuer) {
      toast.error("Please enter an issuer URL first", { duration: 6000 });
      return;
    }
    testOidcMutation.mutate({ issuer });
  };

  const [teamMappings, setTeamMappings] = useState<Array<{group: string; teamIds: string[]; role: "VIEWER" | "EDITOR" | "ADMIN"}>>([]);

  function mergeMappings(
    flat: Array<{ group: string; teamId: string; role: string }>
  ): Array<{ group: string; teamIds: string[]; role: "VIEWER" | "EDITOR" | "ADMIN" }> {
    const map = new Map<string, { group: string; teamIds: string[]; role: "VIEWER" | "EDITOR" | "ADMIN" }>();
    for (const m of flat) {
      const key = `${m.group}::${m.role}`;
      const existing = map.get(key);
      if (existing) {
        existing.teamIds.push(m.teamId);
      } else {
        map.set(key, { group: m.group, teamIds: [m.teamId], role: m.role as "VIEWER" | "EDITOR" | "ADMIN" });
      }
    }
    return [...map.values()];
  }

  function flattenMappings(
    grouped: Array<{ group: string; teamIds: string[]; role: "VIEWER" | "EDITOR" | "ADMIN" }>
  ): Array<{ group: string; teamId: string; role: "VIEWER" | "EDITOR" | "ADMIN" }> {
    return grouped.flatMap((row) =>
      row.teamIds.map((teamId) => ({ group: row.group, teamId, role: row.role }))
    );
  }

  const [defaultTeamId, setDefaultTeamId] = useState("");
  const [defaultRole, setDefaultRole] = useState<"VIEWER" | "EDITOR" | "ADMIN">("VIEWER");
  const [groupSyncEnabled, setGroupSyncEnabled] = useState(false);
  const [groupsScope, setGroupsScope] = useState("groups");
  const [groupsClaim, setGroupsClaim] = useState("groups");

  const teamsQuery = useQuery(trpc.admin.listTeams.queryOptions());

  useEffect(() => {
    if (!settings) return;
    if (hasLoadedRef.current && isDirty) return; // Don't overwrite dirty state on refetch
    setDefaultRole((settings.oidcDefaultRole as "VIEWER" | "EDITOR" | "ADMIN") ?? "VIEWER");
    setGroupSyncEnabled(settings.oidcGroupSyncEnabled ?? false);
    setGroupsScope(settings.oidcGroupsScope ?? "");
    setGroupsClaim(settings.oidcGroupsClaim ?? "groups");
    setTeamMappings(
      mergeMappings((settings.oidcTeamMappings ?? []) as Array<{group: string; teamId: string; role: string}>)
    );
    setDefaultTeamId(settings.oidcDefaultTeamId ?? "");
  }, [settings, isDirty]);

  const updateTeamMappingMutation = useMutation(
    // eslint-disable-next-line react-hooks/refs
    trpc.settings.updateOidcTeamMappings.mutationOptions({
      onSuccess: () => {
        setIsDirty(false);
        hasLoadedRef.current = false; // Allow next sync from server
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
        toast.success("OIDC team mapping saved");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save team mapping", { duration: 6000 });
      },
    })
  );

  function addMapping() {
    markDirty();
    setTeamMappings([...teamMappings, { group: "", teamIds: [], role: "VIEWER" }]);
  }

  function removeMapping(index: number) {
    markDirty();
    setTeamMappings(teamMappings.filter((_, i) => i !== index));
  }

  function updateMapping(index: number, field: "group" | "role", value: string) {
    markDirty();
    setTeamMappings(teamMappings.map((m, i) =>
      i === index ? { ...m, [field]: value } : m
    ));
  }

  function updateMappingTeams(index: number, teamIds: string[]) {
    markDirty();
    setTeamMappings(teamMappings.map((m, i) =>
      i === index ? { ...m, teamIds } : m
    ));
  }

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  if (settingsQuery.isError) return <QueryError message="Failed to load auth settings" onRetry={() => settingsQuery.refetch()} />;

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
        <CardTitle className="flex items-center gap-2">
          OIDC / SSO Configuration
          <DemoDisabledBadge className="ml-auto" />
        </CardTitle>
        <CardDescription>
          Configure an OpenID Connect provider to enable single sign-on for your
          team.
        </CardDescription>
        <div className="mt-2">
          <StatusBadge variant={settings?.oidcIssuer && settings?.oidcClientId ? "healthy" : "neutral"}>
            {settings?.oidcIssuer && settings?.oidcClientId ? "Enabled" : "Disabled"}
          </StatusBadge>
        </div>
      </CardHeader>
      <CardContent>
       <DemoDisabledFieldset message="OIDC / SSO configuration is disabled in the public demo. The fields below cannot be edited or saved.">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="oidc-issuer">Issuer URL <span className="text-destructive">*</span></Label>
            <Input
              id="oidc-issuer"
              type="url"
              placeholder="https://accounts.google.com"
              value={issuer}
              onChange={(e) => { markDirty(); setIssuer(e.target.value); }}
              onBlur={() => markFieldTouched("issuer")}
              required
            />
            <p className="text-xs text-muted-foreground">
              The OIDC issuer URL (must support .well-known/openid-configuration)
            </p>
            {touched.issuer && fieldErrors.issuer && (
              <p className="text-xs text-destructive mt-1">{fieldErrors.issuer}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidc-client-id">Client ID <span className="text-destructive">*</span></Label>
            <Input
              id="oidc-client-id"
              placeholder="your-client-id"
              value={clientId}
              onChange={(e) => { markDirty(); setClientId(e.target.value); }}
              onBlur={() => markFieldTouched("clientId")}
              required
            />
            {touched.clientId && fieldErrors.clientId && (
              <p className="text-xs text-destructive mt-1">{fieldErrors.clientId}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidc-client-secret">
              Client Secret {!settings?.oidcClientSecret && <span className="text-destructive">*</span>}
            </Label>
            <Input
              id="oidc-client-secret"
              type="password"
              placeholder={
                settings?.oidcClientSecret
                  ? `Current: ${settings.oidcClientSecret}`
                  : "Enter client secret"
              }
              value={clientSecret}
              onChange={(e) => { markDirty(); setClientSecret(e.target.value); }}
              required={!settings?.oidcClientSecret}
            />
            <p className="text-xs text-muted-foreground">
              {settings?.oidcClientSecret
                ? "Leave blank to keep the existing secret, or enter a new one to replace it."
                : "The client secret from your OIDC provider."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidc-display-name">Display Name <span className="text-destructive">*</span></Label>
            <Input
              id="oidc-display-name"
              placeholder="SSO"
              value={displayName}
              onChange={(e) => { markDirty(); setDisplayName(e.target.value); }}
              required
            />
            <p className="text-xs text-muted-foreground">
              The label shown on the login button (e.g., &quot;Sign in with
              Okta&quot;)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidc-auth-method">Token Auth Method</Label>
            <Select
              value={tokenAuthMethod}
              onValueChange={(val: "client_secret_post" | "client_secret_basic") => { markDirty(); setTokenAuthMethod(val); }}
            >
              <SelectTrigger id="oidc-auth-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client_secret_post">client_secret_post (default)</SelectItem>
                <SelectItem value="client_secret_basic">client_secret_basic</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              How the client secret is sent to the token endpoint. Most providers use client_secret_post.
            </p>
          </div>

          <Separator />

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={
                updateOidcMutation.isPending || !!fieldErrors.issuer || !!fieldErrors.clientId
              }
            >
              {updateOidcMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save OIDC Settings"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={testOidcMutation.isPending || !issuer}
            >
              {testOidcMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : testOidcMutation.isSuccess ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                  Connection OK
                </>
              ) : testOidcMutation.isError ? (
                <>
                  <XCircle className="mr-2 h-4 w-4 text-destructive" />
                  Test Failed
                </>
              ) : (
                "Test Connection"
              )}
            </Button>
          </div>
        </form>
       </DemoDisabledFieldset>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          IdP Group Mappings
          <DemoDisabledBadge className="ml-auto" />
        </CardTitle>
        <CardDescription>
          Map identity provider groups to teams and roles. Used by both OIDC login (via groups claim) and SCIM sync (via group membership).
        </CardDescription>
      </CardHeader>
      <CardContent>
       <DemoDisabledFieldset message="Group-to-team mappings are disabled in the public demo.">
        <form onSubmit={(e) => {
          e.preventDefault();
          updateTeamMappingMutation.mutate({
            mappings: flattenMappings(teamMappings).filter((m) => m.group && m.teamId),
            defaultTeamId: defaultTeamId || undefined,
            defaultRole,
            groupSyncEnabled,
            groupsScope,
            groupsClaim,
          });
        }} className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="oidc-group-sync">Enable Group Sync</Label>
              <p className="text-xs text-muted-foreground">
                Request group claims from your OIDC provider and sync team memberships
              </p>
            </div>
            <Switch
              id="oidc-group-sync"
              checked={groupSyncEnabled}
              onCheckedChange={setGroupSyncEnabled}
            />
          </div>

          {groupSyncEnabled && (<>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="oidc-groups-scope">Groups Scope</Label>
              <Input
                id="oidc-groups-scope"
                placeholder="groups"
                value={groupsScope}
                onChange={(e) => { setGroupsScope(e.target.value); }}
              />
              <p className="text-xs text-muted-foreground">
                Extra scope to request. Leave empty if your provider includes groups automatically (e.g., Azure AD, Cognito).
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="oidc-groups-claim">Groups Claim</Label>
              <Input
                id="oidc-groups-claim"
                placeholder="groups"
                value={groupsClaim}
                onChange={(e) => { setGroupsClaim(e.target.value); }}
                required
              />
              <p className="text-xs text-muted-foreground">
                Token claim containing group names (e.g., &quot;groups&quot;, &quot;cognito:groups&quot;)
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Group Mappings</Label>
            {teamMappings.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group Name</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamMappings.map((mapping, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Input
                          value={mapping.group}
                          onChange={(e) => updateMapping(index, "group", e.target.value)}
                          placeholder="e.g., vectorflow-admins"
                        />
                      </TableCell>
                      <TableCell>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" type="button" className="w-full justify-start text-left font-normal">
                              {mapping.teamIds.length === 0 && (
                                <span className="text-muted-foreground">Select teams...</span>
                              )}
                              {mapping.teamIds.length === 1 && (
                                <span>{(teamsQuery.data ?? []).find((t) => t.id === mapping.teamIds[0])?.name ?? "Unknown"}</span>
                              )}
                              {mapping.teamIds.length > 1 && (
                                <Badge variant="secondary" className="text-xs">
                                  {mapping.teamIds.length} teams
                                </Badge>
                              )}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-56 p-2" align="start">
                            <div className="space-y-1">
                              {(teamsQuery.data ?? []).map((team) => {
                                const checked = mapping.teamIds.includes(team.id);
                                return (
                                  <button
                                    key={team.id}
                                    type="button"
                                    className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                                    onClick={() => {
                                      const next = checked
                                        ? mapping.teamIds.filter((id) => id !== team.id)
                                        : [...mapping.teamIds, team.id];
                                      updateMappingTeams(index, next);
                                    }}
                                  >
                                    <div className={`flex h-4 w-4 items-center justify-center rounded-sm border ${checked ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                                      {checked && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
                                    </div>
                                    <span>{team.name}</span>
                                    {checked && (
                                      <X
                                        className="ml-auto h-3 w-3 text-muted-foreground hover:text-foreground"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          updateMappingTeams(index, mapping.teamIds.filter((id) => id !== team.id));
                                        }}
                                      />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping.role}
                          onValueChange={(val) => updateMapping(index, "role", val)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="VIEWER">Viewer</SelectItem>
                            <SelectItem value="EDITOR">Editor</SelectItem>
                            <SelectItem value="ADMIN">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove mapping"
                          onClick={() => removeMapping(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Button type="button" variant="outline" size="sm" onClick={addMapping}>
              <Plus className="mr-2 h-4 w-4" />
              Add Mapping
            </Button>
            {teamMappings.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No mappings configured. SSO users will be assigned to the default team with the default role.
              </p>
            )}
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="oidc-default-team">Default Team</Label>
              <Select value={defaultTeamId} onValueChange={(val) => { setDefaultTeamId(val); }}>
                <SelectTrigger id="oidc-default-team">
                  <SelectValue placeholder="Select default team" />
                </SelectTrigger>
                <SelectContent>
                  {(teamsQuery.data ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Fallback team for users who don&apos;t match any group mapping
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="oidc-default-role">Default Role</Label>
              <Select
                value={defaultRole}
                onValueChange={(val: "VIEWER" | "EDITOR" | "ADMIN") => { setDefaultRole(val); }}
              >
                <SelectTrigger id="oidc-default-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                  <SelectItem value="EDITOR">Editor</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          </>)}
          <Button type="submit" disabled={updateTeamMappingMutation.isPending}>
            {updateTeamMappingMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Team Mapping"
            )}
          </Button>
        </form>
       </DemoDisabledFieldset>
      </CardContent>
    </Card>
    </div>
  );
}
