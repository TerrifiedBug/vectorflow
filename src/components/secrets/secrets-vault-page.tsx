"use client";

import * as React from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { Button } from "@/components/ui/button";
import { KpiInStrip, KpiStrip } from "@/components/ui/kpi-tile";
import { VFIcon } from "@/components/ui/vf-icon";
import { Pill } from "@/components/ui/pill";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CertificateBundleDialog, type BundleDialogCertificateOption, type BundleDialogValue } from "@/components/certificate-bundle-dialog";
import { certExpiryBadgeClass } from "@/lib/badge-variants";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type VaultKind = "secret" | "ca" | "cert" | "key";
type VaultStatus = "ok" | "fresh" | "aging" | "unused" | "valid" | "expiring" | "expired" | "na";

type EnvironmentOption = { id: string; name: string };
type RotateTarget = { rowKey: string; occurrenceId: string | null } | null;

type DeleteTarget =
  | (VaultOccurrence & { rowKey: string; rowName: string; kind: "secret" })
  | (VaultOccurrence & { rowKey: string; rowName: string; kind: "cert" | "ca" | "key" })
  | null;

interface VaultOccurrence {
  id: string;
  environmentId: string;
  environmentName: string;
  filename?: string;
  fileType?: VaultKind;
  expiryDate?: string | null;
  daysUntilExpiry?: number | null;
}

interface VaultRow {
  id: string;
  key: string;
  kind: VaultKind;
  name: string;
  envs: string[];
  occurrences: VaultOccurrence[];
  createdAt: string;
  updatedAt: string | null;
  uses: number;
  status: VaultStatus;
  rotated: string;
}

interface UsageRef {
  id: string;
  componentType: string;
  pipeline: { id: string; name: string; environment: { id: string; name: string } };
}

interface UsageResult {
  count: number;
  pipelineCount: number;
  refs: UsageRef[];
}

type RawSecret = {
  id: string;
  name: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type RawCertificate = {
  id: string;
  name: string;
  filename: string;
  fileType: "ca" | "cert" | "key";
  createdAt: string | Date;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
};

type RawCertificateBundle = {
  id: string;
  name: string;
  environmentId: string;
  caId: string | null;
  certId: string | null;
  keyId: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  ca: { id: string; name: string; filename: string; fileType: "ca" | "cert" | "key" } | null;
  cert: { id: string; name: string; filename: string; fileType: "ca" | "cert" | "key" } | null;
  key: { id: string; name: string; filename: string; fileType: "ca" | "cert" | "key" } | null;
};

const CERT_FILE_TYPES: Array<{ value: "ca" | "cert" | "key"; label: string }> = [
  { value: "ca", label: "CA Certificate" },
  { value: "cert", label: "Certificate" },
  { value: "key", label: "Private Key" },
];

export function SecretsVaultPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [uploadInputKey, setUploadInputKey] = React.useState(0);
  const teamId = useTeamStore((s) => s.selectedTeamId);

  const envsQ = useQuery({
    ...trpc.environment.list.queryOptions({ teamId: teamId ?? "" }),
    enabled: !!teamId,
  });
  const envs = React.useMemo(
    () => (envsQ.data ?? []) as EnvironmentOption[],
    [envsQ.data],
  );
  const hasEnvironments = envs.length > 0;

  const secretQueries = useQueries({
    queries: envs.map((env) => ({
      ...trpc.secret.list.queryOptions({ environmentId: env.id }),
      enabled: !!env.id,
    })),
  });
  const certificateQueries = useQueries({
    queries: envs.map((env) => ({
      ...trpc.certificate.list.queryOptions({ environmentId: env.id }),
      enabled: !!env.id,
    })),
  });
  const bundleQueries = useQueries({
    queries: envs.map((env) => ({
      ...trpc.certificate.bundleList.queryOptions({ environmentId: env.id }),
      enabled: !!env.id,
    })),
  });
  const allLoading =
    envsQ.isPending ||
    secretQueries.some((query) => query.isPending) ||
    certificateQueries.some((query) => query.isPending) ||
    bundleQueries.some((query) => query.isPending);
  const hasLoadError =
    envsQ.isError ||
    secretQueries.some((query) => query.isError) ||
    certificateQueries.some((query) => query.isError) ||
    bundleQueries.some((query) => query.isError);

  const secretRows = React.useMemo(() => {
    const map = new Map<string, VaultRow>();
    secretQueries.forEach((query, index) => {
      const env = envs[index];
      const envName = env?.name ?? "—";
      const list = (query.data ?? []) as RawSecret[];
      for (const secret of list) {
        const existing = map.get(secret.name);
        const occurrence: VaultOccurrence = {
          id: secret.id,
          environmentId: env?.id ?? "",
          environmentName: envName,
        };
        if (existing) {
          if (!existing.envs.includes(envName)) existing.envs.push(envName);
          existing.occurrences.push(occurrence);
          const secretUpdatedAt = toIsoString(secret.updatedAt);
          if (existing.updatedAt === null || new Date(secretUpdatedAt) > new Date(existing.updatedAt)) {
            existing.updatedAt = secretUpdatedAt;
            existing.rotated = secretRotatedLabel(secret.updatedAt);
            existing.status = secretStatus(existing.updatedAt, existing.uses);
          }
        } else {
          map.set(secret.name, secretToRow(secret, [envName], [occurrence]));
        }
      }
    });
    return Array.from(map.values());
  }, [secretQueries, envs]);

  const certificateRows = React.useMemo(() => {
    const map = new Map<string, VaultRow>();
    certificateQueries.forEach((query, index) => {
      const env = envs[index];
      const envName = env?.name ?? "—";
      const list = (query.data ?? []) as RawCertificate[];
      for (const certificate of list) {
        const kind = certificate.fileType;
        const key = `${kind}:${certificate.name}`;
        const existing = map.get(key);
        const occurrence: VaultOccurrence = {
          id: certificate.id,
          environmentId: env?.id ?? "",
          environmentName: envName,
          filename: certificate.filename,
          fileType: kind,
          expiryDate: certificate.expiryDate,
          daysUntilExpiry: certificate.daysUntilExpiry,
        };
        if (existing) {
          if (!existing.envs.includes(envName)) existing.envs.push(envName);
          existing.occurrences.push(occurrence);
          existing.status = certificateStatus(
            minDaysUntilExpiry(existing.occurrences),
            existing.kind,
          );
        } else {
          map.set(key, certificateToRow(certificate, [envName], [occurrence]));
        }
      }
    });
    return Array.from(map.values());
  }, [certificateQueries, envs]);

  const rows = React.useMemo(
    () => [...secretRows, ...certificateRows].sort(compareVaultRows),
    [secretRows, certificateRows],
  );

  const certificateOptionsByEnvironment = React.useMemo(
    () =>
      Object.fromEntries(
        envs.map((env, index) => [
          env.id,
          ((certificateQueries[index]?.data ?? []) as RawCertificate[]).map((certificate) => ({
            id: certificate.id,
            name: certificate.name,
            filename: certificate.filename,
            fileType: certificate.fileType,
          })) as BundleDialogCertificateOption[],
        ]),
      ),
    [envs, certificateQueries],
  );

  const bundleGroups = React.useMemo(
    () =>
      envs.map((env, index) => ({
        environment: env,
        bundles: (bundleQueries[index]?.data ?? []) as RawCertificateBundle[],
      })),
    [envs, bundleQueries],
  );

  const [selectedRowKey, setSelectedRowKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (rows.length === 0) {
      setSelectedRowKey(null);
      return;
    }
    setSelectedRowKey((current) =>
      current && rows.some((row) => row.key === current) ? current : rows[0]!.key,
    );
  }, [rows]);

  const selected = rows.find((row) => row.key === selectedRowKey) ?? rows[0];
  const selectedOccurrences = selected?.occurrences ?? [];

  const selectedUsageQueries = useQueries({
    queries: selected
      ? selectedOccurrences.map((occurrence) =>
          selected.kind === "secret"
            ? {
                ...trpc.secret.usage.queryOptions({
                  secretId: occurrence.id,
                  environmentId: occurrence.environmentId,
                }),
                enabled: Boolean(occurrence.id && occurrence.environmentId),
              }
            : {
                ...trpc.certificate.usage.queryOptions({
                  certificateId: occurrence.id,
                  environmentId: occurrence.environmentId,
                }),
                enabled: Boolean(occurrence.id && occurrence.environmentId),
              },
        )
      : [],
  });

  const usageRefs = React.useMemo(
    () =>
      selectedUsageQueries.flatMap((query) => {
        const usage = query.data as UsageResult | undefined;
        return usage?.refs ?? [];
      }),
    [selectedUsageQueries],
  );
  const usagePipelineCount = React.useMemo(
    () => new Set(usageRefs.map((ref) => ref.pipeline.id)).size,
    [usageRefs],
  );
  const usageLoading = selectedOccurrences.length > 0 && selectedUsageQueries.some((query) => query.isPending);
  const usageError = selectedUsageQueries.find((query) => query.isError)?.error as Error | undefined;
  const selectedUsageLoaded =
    selectedOccurrences.length > 0 && selectedUsageQueries.every((query) => query.isSuccess);

  const rowsWithUsage = React.useMemo(
    () =>
      rows.map((row) =>
        row.key === selected?.key && selectedUsageLoaded
          ? withUsageStatus(row, usageRefs.length)
          : row,
      ),
    [rows, selected?.key, selectedUsageLoaded, usageRefs.length],
  );

  const selectedWithUsage = selected
    ? rowsWithUsage.find((row) => row.key === selected.key) ?? selected
    : undefined;

  const [page, setPage] = React.useState(0);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(rowsWithUsage.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleRows = rowsWithUsage.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const counts = React.useMemo(
    () => ({
      total: rowsWithUsage.length,
      rotated30d: rowsWithUsage.filter(
        (row) => row.kind === "secret" && row.updatedAt && isWithin(row.updatedAt, 30),
      ).length,
      aging: rowsWithUsage.filter((row) => row.kind === "secret" && row.status === "aging").length,
    }),
    [rowsWithUsage],
  );

  const selectedUnusedValue = !selectedWithUsage
    ? "—"
    : usageLoading
      ? "…"
      : usageError
        ? "!"
        : selectedUsageLoaded
          ? usagePipelineCount === 0
            ? 1
            : 0
          : "—";
  const usedByValue = !selectedWithUsage
    ? "—"
    : usageLoading
      ? "…"
      : usageError
        ? "!"
        : selectedUsageLoaded
          ? usagePipelineCount
          : "—";
  const usedBySub = selectedWithUsage
    ? usageLoading
      ? "loading references"
      : usageError
        ? "usage unavailable"
        : `${selectedWithUsage.name} · ${usagePipelineCount === 1 ? "pipeline" : "pipelines"}`
    : "select a vault entry";

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createEnvId, setCreateEnvId] = React.useState("");
  const [createName, setCreateName] = React.useState("");
  const [createValue, setCreateValue] = React.useState("");
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploadEnvId, setUploadEnvId] = React.useState("");
  const [uploadName, setUploadName] = React.useState("");
  const [uploadFileType, setUploadFileType] = React.useState<"ca" | "cert" | "key">("cert");
  const [uploadFile, setUploadFile] = React.useState<File | null>(null);
  const [rotateTarget, setRotateTarget] = React.useState<RotateTarget>(null);
  const [rotateValue, setRotateValue] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget>(null);
  const [bundleDialogState, setBundleDialogState] = React.useState<{
    mode: "create" | "edit";
    bundleId?: string;
    value: BundleDialogValue;
  } | null>(null);
  const [activeVaultTab, setActiveVaultTab] = React.useState<"entries" | "bundles">("entries");
  const [bundleDeleteTarget, setBundleDeleteTarget] = React.useState<{
    id: string;
    name: string;
    environmentId: string;
    environmentName: string;
  } | null>(null);

  React.useEffect(() => {
    if (envs.length === 0) {
      setCreateEnvId("");
      setUploadEnvId("");
      return;
    }

    setCreateEnvId((current) =>
      envs.some((env) => env.id === current) ? current : envs[0]!.id,
    );
    setUploadEnvId((current) =>
      envs.some((env) => env.id === current) ? current : envs[0]!.id,
    );
  }, [envs]);

  const createMutation = useMutation(
    trpc.secret.create.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: trpc.secret.list.queryKey({ environmentId: variables.environmentId }),
        });
        toast.success("Secret created");
        setCreateOpen(false);
        setCreateName("");
        setCreateValue("");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create secret", { duration: 6000 });
      },
    }),
  );

  const updateMutation = useMutation(
    trpc.secret.update.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: trpc.secret.list.queryKey({ environmentId: variables.environmentId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.secret.usage.queryKey({
            secretId: variables.id,
            environmentId: variables.environmentId,
          }),
        });
        toast.success("Secret updated");
        setRotateTarget(null);
        setRotateValue("");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update secret", { duration: 6000 });
      },
    }),
  );

  const deleteSecretMutation = useMutation(
    trpc.secret.delete.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: trpc.secret.list.queryKey({ environmentId: variables.environmentId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.secret.usage.queryKey({
            secretId: variables.id,
            environmentId: variables.environmentId,
          }),
        });
        toast.success("Secret deleted");
        setDeleteTarget(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete secret", { duration: 6000 });
      },
    }),
  );

  const uploadMutation = useMutation(
    trpc.certificate.upload.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: trpc.certificate.list.queryKey({ environmentId: variables.environmentId }),
        });
        toast.success("Certificate uploaded");
        resetUploadForm();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to upload certificate", { duration: 6000 });
      },
    }),
  );

  const deleteCertificateMutation = useMutation(
    trpc.certificate.delete.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: trpc.certificate.list.queryKey({ environmentId: variables.environmentId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.certificate.usage.queryKey({
            certificateId: variables.id,
            environmentId: variables.environmentId,
          }),
        });
        toast.success("Certificate deleted");
        setDeleteTarget(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete certificate", { duration: 6000 });
      },
    }),
  );

  const bundleCreateMutation = useMutation(
    trpc.certificate.bundleCreate.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: trpc.certificate.bundleList.queryKey({ environmentId: variables.environmentId }),
        });
        toast.success("Certificate bundle created");
        setBundleDialogState(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create certificate bundle", { duration: 6000 });
      },
    }),
  );

  const bundleUpdateMutation = useMutation(
    trpc.certificate.bundleUpdate.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: trpc.certificate.bundleList.queryKey({ environmentId: variables.environmentId }),
        });
        toast.success("Certificate bundle updated");
        setBundleDialogState(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update certificate bundle", { duration: 6000 });
      },
    }),
  );

  const bundleDeleteMutation = useMutation(
    trpc.certificate.bundleDelete.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: trpc.certificate.bundleList.queryKey({ environmentId: variables.environmentId }),
        });
        toast.success("Certificate bundle deleted");
        setBundleDeleteTarget(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete certificate bundle", { duration: 6000 });
      },
    }),
  );

  const rotateRow = rotateTarget
    ? rows.find((row) => row.key === rotateTarget.rowKey && row.kind === "secret") ?? null
    : null;
  const rotateOccurrences = rotateRow?.occurrences ?? [];
  const selectedRotateOccurrenceId = rotateTarget?.occurrenceId ?? rotateOccurrences[0]?.id ?? "";
  const rotateOccurrence = rotateOccurrences.find((occurrence) => occurrence.id === selectedRotateOccurrenceId) ?? null;

  function openCreateDialog() {
    if (!hasEnvironments) return;
    setCreateOpen(true);
  }

  function openUploadDialog() {
    if (!hasEnvironments) return;
    setUploadOpen(true);
  }

  function openCreateBundleDialog(environmentId?: string) {
    if (!hasEnvironments) return;
    setBundleDialogState({
      mode: "create",
      value: {
        environmentId: environmentId ?? envs[0]?.id ?? "",
        name: "",
        caId: null,
        certId: null,
        keyId: null,
      },
    });
  }

  function openEditBundleDialog(bundle: RawCertificateBundle) {
    setBundleDialogState({
      mode: "edit",
      bundleId: bundle.id,
      value: {
        environmentId: bundle.environmentId,
        name: bundle.name,
        caId: bundle.caId,
        certId: bundle.certId,
        keyId: bundle.keyId,
      },
    });
  }

  function openRotateDialog(row: VaultRow, occurrenceId: string | null) {
    if (row.kind !== "secret") return;
    setRotateTarget({ rowKey: row.key, occurrenceId });
    setRotateValue("");
  }

  function resetUploadForm() {
    setUploadOpen(false);
    setUploadName("");
    setUploadFileType("cert");
    setUploadFile(null);
    setUploadInputKey((current) => current + 1);
  }

  function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!createEnvId) return;
    createMutation.mutate({ environmentId: createEnvId, name: createName, value: createValue });
  }

  function handleRotate(event: React.FormEvent) {
    event.preventDefault();
    if (!rotateOccurrence) return;
    updateMutation.mutate({
      id: rotateOccurrence.id,
      environmentId: rotateOccurrence.environmentId,
      value: rotateValue,
    });
  }

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault();
    if (!uploadEnvId || !uploadFile) return;

    const text = await uploadFile.text();
    uploadMutation.mutate({
      environmentId: uploadEnvId,
      name: uploadName,
      filename: uploadFile.name,
      fileType: uploadFileType,
      dataBase64: btoa(text),
    });
  }

  function handleBundleSubmit(value: BundleDialogValue) {
    if (bundleDialogState?.mode === "edit" && bundleDialogState.bundleId) {
      bundleUpdateMutation.mutate({
        id: bundleDialogState.bundleId,
        environmentId: value.environmentId,
        name: value.name,
        caId: value.caId,
        certId: value.certId,
        keyId: value.keyId,
      });
      return;
    }

    bundleCreateMutation.mutate(value);
  }


  async function handleDownloadCertificate(row: VaultRow) {
    if (row.kind === "secret") return;
    const occurrence = row.occurrences[0];
    if (!occurrence) return;
    try {
      const result = await queryClient.fetchQuery(
        trpc.certificate.getData.queryOptions({
          id: occurrence.id,
          environmentId: occurrence.environmentId,
        }),
      );
      const blob = new Blob([result.data], { type: "application/x-pem-file" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to download certificate";
      toast.error(message, { duration: 6000 });
    }
  }

  function openAudit(row: VaultRow) {
    const occurrenceId = row.occurrences[0]?.id ?? row.name;
    const entityType = row.kind === "secret" ? "Secret" : "Certificate";
    router.push(`/audit?entityType=${entityType}&search=${encodeURIComponent(occurrenceId)}`);
  }

  const bundleDialogPending =
    bundleDialogState?.mode === "edit"
      ? bundleUpdateMutation.isPending
      : bundleCreateMutation.isPending;
  const bundleDialogTitle =
    bundleDialogState?.mode === "edit" ? "Edit bundle" : "Create bundle";
  const bundleDialogSubmitLabel =
    bundleDialogState?.mode === "edit" ? "Save bundle" : "Create bundle";

  const entryLabel = selectedWithUsage?.kind === "secret" ? "secret" : "certificate";

  return (
    <div className="flex h-full flex-col gap-6 bg-bg px-0 text-fg">
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Secrets vault"
          subtitle={
            <>
              Encrypted at rest with envelope encryption. Referenced from pipelines as{" "}
              <span className="font-mono text-fg-1">SECRET[name]</span> and{" "}
              <span className="font-mono text-fg-1">CERT[name]</span>; values never appear in canvas, diff,
              audit log, or wire.
            </>
          }
          breadcrumb="configure / secrets"
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={!selectedWithUsage || selectedWithUsage.kind !== "secret" || selectedWithUsage.occurrences.length === 0}
                onClick={() =>
                  selectedWithUsage?.kind === "secret"
                    ? openRotateDialog(selectedWithUsage, selectedWithUsage.occurrences[0]?.id ?? null)
                    : undefined
                }
              >
                <VFIcon name="rotate-cw" />
                Rotate selected
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="primary" size="sm" disabled={!hasEnvironments}>
                    <VFIcon name="plus" />
                    New
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={openCreateDialog}>New secret</DropdownMenuItem>
                  <DropdownMenuItem onClick={openUploadDialog}>Upload certificate</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openCreateBundleDialog()}>New bundle</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />

        <KpiStrip>
          <KpiInStrip label="TOTAL ENTRIES" value={counts.total} sub={`across ${envs.length} environments`} />
          <KpiInStrip label="ROTATED · 30D" value={counts.rotated30d} sub="secrets only" accent="var(--accent-brand)" />
          <KpiInStrip label="AGING · 90D+" value={counts.aging} sub="secrets only" accent={counts.aging > 0 ? "var(--status-degraded)" : undefined} />
          <KpiInStrip label="SELECTED UNUSED" value={selectedUnusedValue} sub={`selected ${entryLabel} only`} />
          <KpiInStrip label="USED BY" value={usedByValue} sub={usedBySub} />
        </KpiStrip>
      </div>

      {!teamId && (
        <EmptyState
          glyph="◇"
          title="Select a team"
          description="Secrets and certificates are scoped per environment within a team."
        />
      )}

      {teamId && hasLoadError && (
        <EmptyState
          glyph="!"
          title="Failed to load vault entries"
          description={envsQ.error?.message ?? "One or more environment vault lists failed to load."}
        />
      )}

      {teamId && !hasEnvironments && !envsQ.isPending && !envsQ.isError && (
        <EmptyState
          glyph="◎"
          title="Create an environment first"
          description="Secrets and certificates are stored per environment. Add an environment before creating vault entries."
        />
      )}

      {teamId && hasEnvironments && !hasLoadError && (
        <Tabs value={activeVaultTab} onValueChange={(value) => setActiveVaultTab(value as "entries" | "bundles")} className="min-h-0 flex-1 px-6">
          <TabsList variant="mono">
            <TabsTrigger value="entries" onClick={() => setActiveVaultTab("entries")}>Entries</TabsTrigger>
            <TabsTrigger value="bundles" onClick={() => setActiveVaultTab("bundles")}>Bundles</TabsTrigger>
          </TabsList>

          <TabsContent value="entries" className="mt-4 min-h-0 flex-1">
            {rows.length === 0 && !allLoading ? (
              <EmptyState
                glyph="K"
                title="No vault entries yet"
                description="Create a secret or upload a certificate to reference from pipelines as SECRET[name] or CERT[name]."
                action={{ label: "New", onClick: openCreateDialog }}
              />
            ) : rows.length > 0 ? (
              <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: "1fr 440px" }}>
                <div className="flex min-h-0 flex-col border-r border-line">
                  <div
                    className="grid border-b border-line px-5 py-2 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2"
                    style={{ gridTemplateColumns: "1.6fr 100px 110px 1fr 70px 100px" }}
                  >
                    <span>name</span>
                    <span>type</span>
                    <span>last rotated</span>
                    <span>envs</span>
                    <span className="text-right">uses</span>
                    <span className="text-right">status</span>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {visibleRows.map((row) => {
                      const isSelected = row.key === selectedWithUsage?.key;
                      const usageDisplay = isSelected
                        ? usageLoading
                          ? "…"
                          : usageError
                            ? "!"
                            : selectedUsageLoaded
                              ? row.uses
                              : "—"
                        : "—";
                      const usageClass =
                        usageError && isSelected
                          ? "text-status-error"
                          : usageDisplay === "—" || usageDisplay === "…" || usageDisplay === 0
                            ? "text-fg-2"
                            : "text-fg";

                      return (
                        <button
                          key={row.key}
                          type="button"
                          onClick={() => setSelectedRowKey(row.key)}
                          className={cn(
                            "grid w-full cursor-pointer items-center border-b border-line border-l-2 border-l-transparent px-5 py-2.5 text-left font-mono text-[11.5px] transition-colors",
                            isSelected ? "border-l-accent-brand bg-bg-1" : "hover:bg-bg-3/40",
                          )}
                          style={{ gridTemplateColumns: "1.6fr 100px 110px 1fr 70px 100px" }}
                        >
                          <span className="flex items-center gap-1.5 truncate text-fg">
                            <VFIcon name={row.kind === "secret" ? "key" : "shield"} size={13} className="text-fg-2" />
                            {row.name}
                          </span>
                          <span className="text-fg-2">{typeLabel(row.kind)}</span>
                          <span className={row.rotated === "—" || row.rotated === "never" ? "text-fg-2" : "text-fg-1"}>
                            {row.rotated}
                          </span>
                          <span className="flex flex-wrap gap-1">
                            {row.envs.length === 0 && <span className="text-[10.5px] text-fg-2">—</span>}
                            {row.envs.map((envName) => (
                              <Pill key={envName} variant={environmentPillVariant(envName)} size="xs">
                                {envName}
                              </Pill>
                            ))}
                          </span>
                          <span className={cn("text-right", usageClass)}>{usageDisplay}</span>
                          <span className="text-right">
                            <VaultStatusBadge row={row} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {rowsWithUsage.length > pageSize && (
                    <div className="flex items-center justify-between border-t border-line bg-bg-1 px-5 py-3 font-mono text-[11px] text-fg-2">
                      <span>
                        Showing {currentPage * pageSize + 1}–
                        {Math.min((currentPage + 1) * pageSize, rowsWithUsage.length)} of {rowsWithUsage.length} entries
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={currentPage === 0}
                          onClick={() => setPage((value) => Math.max(0, value - 1))}
                        >
                          Previous
                        </Button>
                        <span className="tabular-nums">
                          Page {currentPage + 1} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={currentPage >= totalPages - 1}
                          onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex min-h-0 flex-col overflow-hidden">
                  {selectedWithUsage?.kind === "secret" ? (
                    <SecretDetail
                      row={selectedWithUsage}
                      usageRefs={usageRefs}
                      usageLoading={usageLoading}
                      usageError={usageError}
                      onRotateOccurrence={(occurrence) => openRotateDialog(selectedWithUsage, occurrence.id)}
                      onDeleteOccurrence={(occurrence) =>
                        setDeleteTarget({
                          ...occurrence,
                          rowKey: selectedWithUsage.key,
                          rowName: selectedWithUsage.name,
                          kind: "secret",
                        })
                      }
                      onViewAudit={() => openAudit(selectedWithUsage)}
                    />
                  ) : selectedWithUsage ? (
                    <CertificateDetail
                      row={selectedWithUsage}
                      usageRefs={usageRefs}
                      usageLoading={usageLoading}
                      usageError={usageError}
                      onDeleteOccurrence={(occurrence) =>
                        setDeleteTarget({
                          ...occurrence,
                          rowKey: selectedWithUsage.key,
                          rowName: selectedWithUsage.name,
                          kind: selectedWithUsage.kind,
                        })
                      }
                      onDownloadPem={() => handleDownloadCertificate(selectedWithUsage)}
                      onViewAudit={() => openAudit(selectedWithUsage)}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="bundles" className="mt-4 min-h-0 flex-1">
            <div className="flex flex-col gap-4">
              {bundleGroups.map(({ environment, bundles }) => (
                <div key={environment.id} className="rounded-[3px] border border-line bg-bg-1">
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-fg-2">
                        {environment.name}
                      </p>
                      <p className="text-[11px] text-fg-2">
                        {bundles.length === 0 ? "No bundles yet" : `${bundles.length} bundle${bundles.length === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openCreateBundleDialog(environment.id)}>
                      New bundle
                    </Button>
                  </div>

                  {bundles.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-fg-2">
                      No bundles in this environment.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>CA</TableHead>
                          <TableHead>Certificate</TableHead>
                          <TableHead>Private Key</TableHead>
                          <TableHead>Updated</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bundles.map((bundle) => (
                          <TableRow key={bundle.id}>
                            <TableCell className="font-mono text-sm font-medium">{bundle.name}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{bundle.ca?.name ?? "—"}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{bundle.cert?.name ?? "—"}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{bundle.key?.name ?? "—"}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {toIsoString(bundle.updatedAt)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button variant="ghost" size="sm" onClick={() => openEditBundleDialog(bundle)}>
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-status-error hover:text-status-error"
                                  onClick={() =>
                                    setBundleDeleteTarget({
                                      id: bundle.id,
                                      name: bundle.name,
                                      environmentId: bundle.environmentId,
                                      environmentName: environment.name,
                                    })
                                  }
                                >
                                  Delete
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateName("");
            setCreateValue("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create secret</DialogTitle>
            <DialogDescription>
              Create a new encrypted secret and scope it to a single environment.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="secret-environment">Environment</Label>
              <Select value={createEnvId} onValueChange={setCreateEnvId}>
                <SelectTrigger id="secret-environment">
                  <SelectValue placeholder="Select environment" />
                </SelectTrigger>
                <SelectContent>
                  {envs.map((env) => (
                    <SelectItem key={env.id} value={env.id}>
                      {env.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret-name">Name</Label>
              <Input
                id="secret-name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="MY_API_KEY"
                pattern="^[a-zA-Z0-9][a-zA-Z0-9_-]*$"
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Start with a letter or number. Only letters, numbers, hyphens, and underscores.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret-value">Value</Label>
              <Input
                id="secret-value"
                type="password"
                value={createValue}
                onChange={(event) => setCreateValue(event.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || !createEnvId}>
                {createMutation.isPending ? "Creating..." : "Create secret"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          if (!open) resetUploadForm();
          else setUploadOpen(true);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload certificate</DialogTitle>
            <DialogDescription>
              Upload a PEM-encoded certificate or private key file. Maximum size: 100KB.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="certificate-environment">Environment</Label>
              <Select value={uploadEnvId} onValueChange={setUploadEnvId}>
                <SelectTrigger id="certificate-environment">
                  <SelectValue placeholder="Select environment" />
                </SelectTrigger>
                <SelectContent>
                  {envs.map((env) => (
                    <SelectItem key={env.id} value={env.id}>
                      {env.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cert-name">Name</Label>
              <Input
                id="cert-name"
                value={uploadName}
                onChange={(event) => setUploadName(event.target.value)}
                placeholder="my-tls-cert"
                pattern="^[a-zA-Z0-9][a-zA-Z0-9_-]*$"
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                A unique name to reference this certificate in pipeline configs.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cert-type">Type</Label>
              <Select value={uploadFileType} onValueChange={(value) => setUploadFileType(value as "ca" | "cert" | "key")}>
                <SelectTrigger id="cert-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CERT_FILE_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cert-file">File</Label>
              <Input
                key={uploadInputKey}
                id="cert-file"
                type="file"
                accept=".pem,.crt,.cert,.key,.ca"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                required
              />
              <p className="text-xs text-muted-foreground">
                PEM-encoded file (must contain -----BEGIN header)
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetUploadForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={uploadMutation.isPending || !uploadEnvId || !uploadFile}>
                {uploadMutation.isPending ? "Uploading..." : "Upload"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CertificateBundleDialog
        open={!!bundleDialogState}
        onOpenChange={(open) => {
          if (!open) setBundleDialogState(null);
        }}
        title={bundleDialogTitle}
        description="Group existing CA, certificate, and key files under a single bundle name for TLS forms."
        submitLabel={bundleDialogSubmitLabel}
        isPending={bundleDialogPending}
        environments={envs}
        certificatesByEnvironment={certificateOptionsByEnvironment}
        initialValue={bundleDialogState?.value ?? null}
        onSubmit={handleBundleSubmit}
      />


      <Dialog
        open={!!rotateTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRotateTarget(null);
            setRotateValue("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate secret</DialogTitle>
            <DialogDescription>
              Set a new value for <span className="font-mono font-semibold">{rotateRow?.name}</span>.
              The previous value cannot be recovered.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRotate} className="space-y-4">
            {rotateOccurrences.length > 1 ? (
              <div className="space-y-2">
                <Label htmlFor="rotate-environment">Environment</Label>
                <Select
                  value={selectedRotateOccurrenceId}
                  onValueChange={(occurrenceId) =>
                    setRotateTarget((current) =>
                      current ? { ...current, occurrenceId } : current,
                    )
                  }
                >
                  <SelectTrigger id="rotate-environment">
                    <SelectValue placeholder="Select environment" />
                  </SelectTrigger>
                  <SelectContent>
                    {rotateOccurrences.map((occurrence) => (
                      <SelectItem key={occurrence.id} value={occurrence.id}>
                        {occurrence.environmentName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {rotateOccurrence ? (
              <div className="rounded-[3px] border border-line bg-bg-2 px-3 py-2 font-mono text-[11.5px] text-fg-1">
                Rotating value in <span className="text-fg">{rotateOccurrence.environmentName}</span>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="rotate-value">New value</Label>
              <Input
                id="rotate-value"
                type="password"
                value={rotateValue}
                onChange={(event) => setRotateValue(event.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRotateTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending || !rotateOccurrence}>
                {updateMutation.isPending ? "Rotating..." : "Rotate secret"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget?.kind === "secret" ? "Delete secret" : "Delete certificate"}
        description={
          deleteTarget ? (
            <>
              Permanently delete <span className="font-mono font-semibold">{deleteTarget.rowName}</span>
              from <span className="font-mono font-semibold">{deleteTarget.environmentName}</span>?
              Any pipeline configs referencing this {deleteTarget.kind === "secret" ? "secret" : "certificate"} will fail at deploy time.
            </>
          ) : null
        }
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteTarget?.kind === "secret" ? deleteSecretMutation.isPending : deleteCertificateMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.kind === "secret") {
            deleteSecretMutation.mutate({
              id: deleteTarget.id,
              environmentId: deleteTarget.environmentId,
            });
            return;
          }
          deleteCertificateMutation.mutate({
            id: deleteTarget.id,
            environmentId: deleteTarget.environmentId,
          });
        }}
      />

      <ConfirmDialog
        open={!!bundleDeleteTarget}
        onOpenChange={(open) => !open && setBundleDeleteTarget(null)}
        title="Delete bundle"
        description={
          bundleDeleteTarget ? (
            <>
              Permanently delete <span className="font-mono font-semibold">{bundleDeleteTarget.name}</span>
              from <span className="font-mono font-semibold">{bundleDeleteTarget.environmentName}</span>?
              Pipelines that already saved individual CERT refs will keep working, but operators will no longer be able to pick this bundle in TLS forms.
            </>
          ) : null
        }
        confirmLabel="Delete"
        variant="destructive"
        isPending={bundleDeleteMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={() => {
          if (!bundleDeleteTarget) return;
          bundleDeleteMutation.mutate({
            id: bundleDeleteTarget.id,
            environmentId: bundleDeleteTarget.environmentId,
          });
        }}
      />
    </div>
  );
}

function withUsageStatus(row: VaultRow, useCount: number): VaultRow {
  if (row.kind !== "secret") return { ...row, uses: useCount };
  if (useCount === 0) return { ...row, uses: 0, status: "unused" };
  if (row.status === "unused") return { ...row, uses: useCount, status: "ok" };
  return { ...row, uses: useCount };
}

function VaultStatusBadge({ row }: { row: VaultRow }) {
  if (row.kind === "secret") {
    if (row.status === "ok") return <span className="text-[10px] tracking-[0.04em] text-accent-brand">OK</span>;
    if (row.status === "fresh") return <span className="text-[10px] tracking-[0.04em] text-status-info">FRESH</span>;
    if (row.status === "unused") return <span className="text-[10px] tracking-[0.04em] text-fg-2">UNUSED</span>;
    return (
      <span className="rounded-[3px] border border-[color:var(--status-degraded)]/40 bg-[color:var(--status-degraded-bg)] px-1.5 py-0.5 text-[9.5px] tracking-[0.04em] text-status-degraded">
        AGING
      </span>
    );
  }

  if (row.status === "expired") {
    return <span className="text-[10px] tracking-[0.04em] text-status-error">EXPIRED</span>;
  }
  if (row.status === "expiring") {
    return <span className="text-[10px] tracking-[0.04em] text-status-degraded">EXPIRING</span>;
  }
  if (row.status === "na") {
    return <span className="text-[10px] tracking-[0.04em] text-fg-2">N/A</span>;
  }
  return <span className="text-[10px] tracking-[0.04em] text-accent-brand">VALID</span>;
}

function SecretDetail({
  row,
  usageRefs,
  usageLoading,
  usageError,
  onRotateOccurrence,
  onDeleteOccurrence,
  onViewAudit,
}: {
  row: VaultRow;
  usageRefs: UsageRef[];
  usageLoading: boolean;
  usageError?: Error;
  onRotateOccurrence: (occurrence: VaultOccurrence) => void;
  onDeleteOccurrence: (occurrence: VaultOccurrence) => void;
  onViewAudit: () => void;
}) {
  const usagePipelineCount = new Set(usageRefs.map((ref) => ref.pipeline.id)).size;
  const usageNodeCount = usageRefs.length;

  return (
    <>
      <div className="border-b border-line bg-bg-1 px-5 py-3.5">
        <div className="font-mono text-[10.5px] tracking-[0.04em] text-fg-2">
          created {timeAgo(row.createdAt)} ago
        </div>
        <div className="mt-1 font-mono text-[16px] text-fg">{row.name}</div>
      </div>

      <div className="flex-1 overflow-auto p-5">
        <div className="mb-4">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
            Value
          </div>
          <div className="flex items-center gap-2 rounded-[3px] border border-line bg-bg-2 px-3 py-2 font-mono text-[12px] text-fg-1">
            <span className="flex-1 tracking-[2px]">••••••••••••••••••••••••••</span>
          </div>
          <div className="mt-1.5 font-mono text-[10.5px] text-fg-2">
            Values stay encrypted at rest and are never shown in this UI.
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
            Rotation
          </div>
          <div className="rounded-[3px] border border-line bg-bg-2 p-3 font-mono text-[11.5px] leading-[1.7]">
            <div className="flex justify-between">
              <span className="text-fg-2">last rotated</span>
              <span className="text-fg">{row.rotated}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-2">cadence</span>
              <span className="text-fg">manual</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-2">occurrences</span>
              <span className="text-fg">{row.occurrences.length}</span>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
            Occurrences
          </div>
          <div className="overflow-hidden rounded-[3px] border border-line bg-bg-2">
            <div className="divide-y divide-line">
              {row.occurrences.map((occurrence) => (
                <div key={occurrence.id} className="flex items-center gap-2 px-3 py-2 font-mono text-[11.5px]">
                  <Pill variant={environmentPillVariant(occurrence.environmentName)} size="xs">
                    {occurrence.environmentName}
                  </Pill>
                  <span className="min-w-0 flex-1 truncate text-fg-1">{occurrence.id}</span>
                  <Button variant="ghost" size="xs" onClick={() => onRotateOccurrence(occurrence)}>
                    Rotate
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-status-error"
                    onClick={() => onDeleteOccurrence(occurrence)}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <UsageSection usageRefs={usageRefs} usageLoading={usageLoading} usageError={usageError} usagePipelineCount={usagePipelineCount} usageNodeCount={usageNodeCount} />
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-bg-1 px-4 py-3">
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onViewAudit}>
          <VFIcon name="external-link" />
          View audit
        </Button>
      </div>
    </>
  );
}

function CertificateDetail({
  row,
  usageRefs,
  usageLoading,
  usageError,
  onDeleteOccurrence,
  onDownloadPem,
  onViewAudit,
}: {
  row: VaultRow;
  usageRefs: UsageRef[];
  usageLoading: boolean;
  usageError?: Error;
  onDeleteOccurrence: (occurrence: VaultOccurrence) => void;
  onDownloadPem: () => void;
  onViewAudit: () => void;
}) {
  const primaryOccurrence = row.occurrences[0];
  const usagePipelineCount = new Set(usageRefs.map((ref) => ref.pipeline.id)).size;
  const usageNodeCount = usageRefs.length;
  const daysUntilExpiry = minDaysUntilExpiry(row.occurrences);

  return (
    <>
      <div className="border-b border-line bg-bg-1 px-5 py-3.5">
        <div className="font-mono text-[10.5px] tracking-[0.04em] text-fg-2">
          created {timeAgo(row.createdAt)} ago
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className="font-mono text-[16px] text-fg">{row.name}</div>
          <Badge variant="outline">{typeLabel(row.kind)}</Badge>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5">
        <div className="mb-4 rounded-[3px] border border-line bg-bg-2 p-3 font-mono text-[11.5px] leading-[1.8]">
          <div className="flex justify-between gap-4">
            <span className="text-fg-2">filename</span>
            <span className="truncate text-fg" title={primaryOccurrence?.filename}>{primaryOccurrence?.filename ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-fg-2">type</span>
            <span className="text-fg">{typeLabel(row.kind)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-fg-2">expires</span>
            <span className="text-fg">{primaryOccurrence?.expiryDate ? new Date(primaryOccurrence.expiryDate).toLocaleDateString() : "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-fg-2">status</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={certExpiryBadgeClass(daysUntilExpiry)}>
                {certStatusLabel(daysUntilExpiry)}
              </Badge>
              {certDaysText(daysUntilExpiry) ? (
                <span className="text-[10.5px] text-fg-2">{certDaysText(daysUntilExpiry)}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
            Occurrences
          </div>
          <div className="overflow-hidden rounded-[3px] border border-line bg-bg-2">
            <div className="divide-y divide-line">
              {row.occurrences.map((occurrence) => (
                <div key={occurrence.id} className="flex items-center gap-2 px-3 py-2 font-mono text-[11.5px]">
                  <Pill variant={environmentPillVariant(occurrence.environmentName)} size="xs">
                    {occurrence.environmentName}
                  </Pill>
                  <span className="min-w-0 flex-1 truncate text-fg-1" title={occurrence.filename}>
                    {occurrence.filename ?? occurrence.id}
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-status-error"
                    onClick={() => onDeleteOccurrence(occurrence)}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <UsageSection usageRefs={usageRefs} usageLoading={usageLoading} usageError={usageError} usagePipelineCount={usagePipelineCount} usageNodeCount={usageNodeCount} />
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-bg-1 px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onDownloadPem}>
          <VFIcon name="download" />
          Download PEM
        </Button>
        <Button variant="ghost" size="sm" onClick={onViewAudit}>
          <VFIcon name="external-link" />
          View audit
        </Button>
      </div>
    </>
  );
}

function UsageSection({
  usageRefs,
  usageLoading,
  usageError,
  usagePipelineCount,
  usageNodeCount,
}: {
  usageRefs: UsageRef[];
  usageLoading: boolean;
  usageError?: Error;
  usagePipelineCount: number;
  usageNodeCount: number;
}) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
        Used by · {usageError ? "unavailable" : usageLoading ? "…" : `${usagePipelineCount} pipeline${usagePipelineCount === 1 ? "" : "s"}`}
      </div>
      <div className="overflow-hidden rounded-[3px] border border-line bg-bg-2">
        {usageLoading ? (
          <div className="px-3 py-3 text-center font-mono text-[11px] text-fg-2">
            Loading references…
          </div>
        ) : usageError ? (
          <div className="px-3 py-3 text-center font-mono text-[11px] text-status-error">
            {usageError.message}
          </div>
        ) : usageNodeCount === 0 ? (
          <div className="px-3 py-3 text-center font-mono text-[11px] text-fg-2">
            Not referenced by any pipeline yet.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {usageRefs.map((ref) => (
              <div
                key={ref.id}
                className="grid items-center px-3 py-2 font-mono text-[11.5px]"
                style={{ gridTemplateColumns: "1fr 80px 1fr" }}
              >
                <span className="truncate text-fg" title={ref.pipeline.name}>
                  {ref.pipeline.name}
                </span>
                <span>
                  <Pill variant={environmentPillVariant(ref.pipeline.environment.name)} size="xs">
                    {ref.pipeline.environment.name}
                  </Pill>
                </span>
                <span className="truncate text-right text-fg-1" title={ref.componentType}>
                  {ref.componentType}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function compareVaultRows(a: VaultRow, b: VaultRow) {
  const nameComparison = a.name.localeCompare(b.name);
  if (nameComparison !== 0) return nameComparison;
  return typeLabel(a.kind).localeCompare(typeLabel(b.kind));
}

function typeLabel(kind: VaultKind): string {
  if (kind === "secret") return "SECRET";
  if (kind === "ca") return "CA CERT";
  if (kind === "cert") return "CERT";
  return "KEY";
}

function environmentPillVariant(environmentName: string): "env" | "envProd" {
  return environmentName.startsWith("prod") ? "envProd" : "env";
}

function certStatusLabel(daysUntilExpiry: number | null): string {
  if (daysUntilExpiry === null) return "N/A";
  if (daysUntilExpiry <= 0) return "Expired";
  if (daysUntilExpiry <= 30) return "Expiring";
  return "Valid";
}

function certDaysText(daysUntilExpiry: number | null): string | null {
  if (daysUntilExpiry === null) return null;
  if (daysUntilExpiry <= 0) return `${Math.abs(daysUntilExpiry)}d ago`;
  return `${daysUntilExpiry}d remaining`;
}

function secretStatus(updatedAt: string | null, uses: number): VaultStatus {
  if (uses === 0) return "unused";
  if (!updatedAt) return "ok";
  const ageDays = (Date.now() - new Date(updatedAt).getTime()) / (24 * 60 * 60 * 1000);
  if (ageDays > 90) return "aging";
  if (ageDays < 7) return "fresh";
  return "ok";
}

function certificateStatus(daysUntilExpiry: number | null, kind: VaultKind): VaultStatus {
  if (kind === "key") return "na";
  if (daysUntilExpiry === null) return "na";
  if (daysUntilExpiry <= 0) return "expired";
  if (daysUntilExpiry <= 30) return "expiring";
  return "valid";
}

function minDaysUntilExpiry(occurrences: VaultOccurrence[]): number | null {
  const values = occurrences
    .map((occurrence) => occurrence.daysUntilExpiry)
    .filter((value): value is number => value !== null && value !== undefined);
  if (values.length === 0) return null;
  return Math.min(...values);
}

function isWithin(iso: string, days: number): boolean {
  const ms = Date.now() - new Date(iso).getTime();
  return ms < days * 24 * 60 * 60 * 1000;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (d > 0) return `${d}d`;
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h > 0) return `${h}h`;
  return `${Math.floor(ms / 60000)}m`;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function secretRotatedLabel(updatedAt: string | Date): string {
  const iso = toIsoString(updatedAt);
  const ageDays = (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
  return ageDays < 1 ? "today" : `${Math.floor(ageDays)}d ago`;
}

function secretToRow(
  secret: RawSecret,
  envs: string[],
  occurrences: VaultOccurrence[],
): VaultRow {
  const updatedAt = toIsoString(secret.updatedAt);
  return {
    id: secret.id,
    key: `secret:${secret.name}`,
    kind: "secret",
    name: secret.name,
    envs,
    occurrences,
    createdAt: toIsoString(secret.createdAt),
    updatedAt,
    uses: 1,
    status: secretStatus(updatedAt, 1),
    rotated: secretRotatedLabel(updatedAt),
  };
}

function certificateToRow(
  certificate: RawCertificate,
  envs: string[],
  occurrences: VaultOccurrence[],
): VaultRow {
  return {
    id: certificate.id,
    key: `${certificate.fileType}:${certificate.name}`,
    kind: certificate.fileType,
    name: certificate.name,
    envs,
    occurrences,
    createdAt: toIsoString(certificate.createdAt),
    updatedAt: null,
    uses: 0,
    status: certificateStatus(certificate.daysUntilExpiry, certificate.fileType),
    rotated: "—",
  };
}
