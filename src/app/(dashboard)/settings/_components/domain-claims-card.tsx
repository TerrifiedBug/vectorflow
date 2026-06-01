"use client";

/**
 * Domain claims surface (SSO settings).
 *
 * Exposes the DNS-TXT domain-ownership primitive (`org.claimDomain /
 * verifyDomain / listDomains / unclaimDomain`) that previously had no
 * client caller. A verified claim covering the OIDC issuer hostname is a
 * precondition for `settings.updateOidc` — without this card the
 * mutation throws PRECONDITION_FAILED with no in-product way to satisfy
 * it.
 *
 * Role gating mirrors `OrganizationSettings`: ownership is derived from
 * `user.me` + `org.listMembers`. Claiming / removing is OWNER-only;
 * verifying is OWNER or ADMIN. The mutations re-check every invariant
 * server-side, so the UI guards are convenience, not security.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  Copy,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { useTRPC } from "@/trpc/client";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DemoDisabledBadge,
  DemoDisabledFieldset,
} from "@/components/demo-disabled";
import { PermissionDenied } from "@/components/ui/permission-denied";
import { copyToClipboard } from "@/lib/utils";

type DnsRecord = { host: string; type: "TXT"; value: string };

function formatTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function DomainClaimsCard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const meQuery = useQuery(trpc.user.me.queryOptions());
  const membersQuery = useQuery(
    trpc.org.listMembers.queryOptions(undefined, { retry: false }),
  );
  const listQuery = useQuery(
    trpc.org.listDomains.queryOptions(undefined, { retry: false }),
  );

  const [domain, setDomain] = useState("");
  const [pendingRecord, setPendingRecord] = useState<{
    domain: string;
    record: DnsRecord;
  } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    domain: string;
  } | null>(null);

  const email = meQuery.data?.email ?? null;
  const selfRole =
    membersQuery.data?.find((m) => m.email === email)?.role ?? null;
  const isOwner = selfRole === "OWNER";

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.org.listDomains.queryKey(),
    });

  const claimMutation = useMutation(
    trpc.org.claimDomain.mutationOptions({
      onSuccess: (data) => {
        setPendingRecord({ domain: data.domain, record: data.instructions });
        setDomain("");
        invalidate();
        toast.success(
          `Claim started for ${data.domain}. Publish the DNS record below, then verify.`,
        );
      },
      onError: (error) =>
        toast.error(error.message || "Failed to start domain claim", {
          duration: 6000,
        }),
    }),
  );

  const verifyMutation = useMutation(
    trpc.org.verifyDomain.mutationOptions({
      onSuccess: (data) => {
        invalidate();
        if (data.verified) {
          toast.success("Domain verified. OIDC saves for this domain are now unblocked.");
        } else {
          toast.error(
            data.error || "Verification failed — the DNS TXT record was not found yet.",
            { duration: 6000 },
          );
        }
      },
      onError: (error) =>
        toast.error(error.message || "Verification failed", { duration: 6000 }),
    }),
  );

  const unclaimMutation = useMutation(
    trpc.org.unclaimDomain.mutationOptions({
      onSuccess: () => {
        invalidate();
        setRemoveTarget(null);
        toast.success("Domain claim removed.");
      },
      onError: (error) =>
        toast.error(error.message || "Failed to remove domain claim", {
          duration: 6000,
        }),
    }),
  );

  const claims = listQuery.data ?? [];
  const hasVerified = claims.some((c) => c.verifiedAt != null);

  function handleClaim(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = domain.trim();
    if (trimmed.length < 3) {
      toast.error("Enter a domain (e.g. example.com)");
      return;
    }
    claimMutation.mutate({ domain: trimmed });
  }

  async function handleCopy(record: DnsRecord) {
    await copyToClipboard(record.value);
    toast.success("TXT value copied to clipboard");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Domain claims
          <DemoDisabledBadge className="ml-auto" />
        </CardTitle>
        <CardDescription>
          Prove ownership of a domain via a DNS TXT record. A verified domain
          that covers your OIDC issuer&apos;s hostname is required before SSO
          configuration can be saved.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {listQuery.isError ? (
          <PermissionDenied
            resource="domain claims"
            requiredRole="OWNER or ADMIN"
          />
        ) : listQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <DemoDisabledFieldset message="Domain claims are disabled in the public demo.">
            <div className="space-y-6">
              {!hasVerified && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>No verified domains yet</AlertTitle>
                  <AlertDescription>
                    OIDC / SSO configuration cannot be saved until a domain
                    matching your issuer&apos;s hostname is verified here.
                  </AlertDescription>
                </Alert>
              )}

              {isOwner ? (
                <form
                  onSubmit={handleClaim}
                  className="flex flex-col gap-2 sm:flex-row sm:items-end"
                >
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="domain-claim-input">Domain</Label>
                    <Input
                      id="domain-claim-input"
                      placeholder="example.com"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <Button type="submit" disabled={claimMutation.isPending}>
                    {claimMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Claiming...
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 h-4 w-4" />
                        Claim domain
                      </>
                    )}
                  </Button>
                </form>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Claiming and removing domains requires the organisation OWNER.
                  You can verify pending claims below.
                </p>
              )}

              {pendingRecord && (
                <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                  <p className="text-sm font-medium">
                    Publish this DNS record for{" "}
                    <span className="font-mono">{pendingRecord.domain}</span>
                  </p>
                  <div className="grid gap-2 text-xs sm:grid-cols-[auto_1fr]">
                    <span className="text-muted-foreground">Type</span>
                    <span className="font-mono">{pendingRecord.record.type}</span>
                    <span className="text-muted-foreground">Host</span>
                    <span className="font-mono break-all">
                      {pendingRecord.record.host}
                    </span>
                    <span className="text-muted-foreground">Value</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono break-all">
                        {pendingRecord.record.value}
                      </span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        aria-label="Copy TXT value"
                        onClick={() => handleCopy(pendingRecord.record)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    DNS changes can take a few minutes to propagate. Use{" "}
                    <span className="font-medium">Verify</span> once the record
                    is live.
                  </p>
                </div>
              )}

              {claims.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No domains claimed yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last checked</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.map((claim) => {
                      const verifying =
                        verifyMutation.isPending &&
                        verifyMutation.variables?.id === claim.id;
                      return (
                        <TableRow key={claim.id}>
                          <TableCell className="font-mono">
                            {claim.domain}
                          </TableCell>
                          <TableCell>
                            {claim.verifiedAt ? (
                              <StatusBadge variant="healthy">
                                Verified
                              </StatusBadge>
                            ) : claim.lastCheckError ? (
                              <StatusBadge variant="error">Failed</StatusBadge>
                            ) : (
                              <StatusBadge variant="neutral">Pending</StatusBadge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {claim.verifiedAt
                              ? `Verified ${formatTimestamp(claim.verifiedAt)}`
                              : claim.lastCheckError
                                ? claim.lastCheckError
                                : formatTimestamp(claim.lastCheckedAt)}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              {!claim.verifiedAt && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={verifying}
                                  onClick={() =>
                                    verifyMutation.mutate({ id: claim.id })
                                  }
                                >
                                  {verifying ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  )}
                                  <span className="ml-1.5">Verify</span>
                                </Button>
                              )}
                              {isOwner && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Remove claim for ${claim.domain}`}
                                  onClick={() =>
                                    setRemoveTarget({
                                      id: claim.id,
                                      domain: claim.domain,
                                    })
                                  }
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </DemoDisabledFieldset>
        )}
      </CardContent>

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove domain claim</DialogTitle>
            <DialogDescription>
              Removing the claim for{" "}
              <span className="font-mono">{removeTarget?.domain}</span> disables
              any policies that depend on it, including OIDC saves for issuers on
              this domain. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRemoveTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={unclaimMutation.isPending}
              onClick={() => {
                if (removeTarget) unclaimMutation.mutate({ id: removeTarget.id });
              }}
            >
              {unclaimMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                "Remove claim"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
