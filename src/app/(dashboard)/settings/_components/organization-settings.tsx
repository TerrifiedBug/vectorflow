"use client";

/**
 * Organisation-level settings client.
 *
 * Today this surfaces a single capability: ownership transfer. The page
 * also doubles as the OrgMember roster view (read-only) so a fresh
 * OWNER landing here can verify who else is in the org before picking
 * a successor.
 *
 * Visibility:
 *   - Anyone with `org.listMembers` access (OWNER or ADMIN) sees the
 *     roster.
 *   - The "Transfer ownership" button only renders when the caller's
 *     row in the roster has `role === "OWNER"`. The tRPC mutation
 *     re-checks the same invariant inside a transaction, so the UI
 *     guard is convenience, not security.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crown, Users, ShieldAlert } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { QueryError } from "@/components/query-error";

import { TransferOwnershipDialog } from "./transfer-ownership-dialog";
import { MemberRowActions } from "./member-row-actions";

function roleBadgeVariant(role: string): "default" | "secondary" | "outline" {
  if (role === "OWNER") return "default";
  if (role === "ADMIN") return "secondary";
  return "outline";
}

export function OrganizationSettings() {
  const trpc = useTRPC();

  const meQuery = useQuery(trpc.user.me.queryOptions());
  const membersQuery = useQuery(trpc.org.listMembers.queryOptions());

  const [transferOpen, setTransferOpen] = useState(false);

  const currentUserEmail = meQuery.data?.email ?? null;
  const members = membersQuery.data ?? [];

  const selfMember = useMemo(() => {
    if (!currentUserEmail) return null;
    return members.find((m) => m.email === currentUserEmail) ?? null;
  }, [members, currentUserEmail]);

  const isOwner = selfMember?.role === "OWNER";

  if (membersQuery.error) {
    return <QueryError message={membersQuery.error.message} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Members
          </CardTitle>
          <CardDescription>
            Everyone with a role on this organisation. Per-team membership is
            managed under <span className="font-mono">My Team</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {membersQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No members yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  {isOwner && (
                    <TableHead className="w-[60px] text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        {m.role === "OWNER" ? (
                          <Crown
                            className="h-3.5 w-3.5 text-amber-500"
                            aria-label="OWNER"
                          />
                        ) : null}
                        {m.name ?? <span className="text-muted-foreground">—</span>}
                      </span>
                    </TableCell>
                    <TableCell>{m.email ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={roleBadgeVariant(m.role)}>{m.role}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.joinedAt
                        ? new Date(m.joinedAt).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    {isOwner && (
                      <TableCell className="text-right">
                        <MemberRowActions
                          member={m}
                          isSelf={m.userId === selfMember?.userId}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isOwner && selfMember ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              Danger zone
            </CardTitle>
            <CardDescription>
              Irreversible actions that change who controls this organisation.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <p className="text-sm font-medium">Transfer ownership</p>
              <p className="text-sm text-muted-foreground">
                Promote another member to OWNER and demote yourself to ADMIN.
                Action is logged in the org audit trail.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => setTransferOpen(true)}
            >
              Transfer ownership
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {selfMember ? (
        <TransferOwnershipDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          currentUserId={selfMember.userId}
          members={members}
        />
      ) : null}
    </div>
  );
}
