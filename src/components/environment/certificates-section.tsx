"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Plus, Trash2, FileKey, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ConfirmDialog } from "@/components/confirm-dialog";

const FILE_TYPE_LABELS: Record<string, string> = {
  ca: "CA Certificate",
  cert: "Certificate",
  key: "Private Key",
};

interface CertificatesSectionProps {
  environmentId: string;
}

export function CertificatesSection({ environmentId }: CertificatesSectionProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const certsQuery = useQuery(
    trpc.certificate.list.queryOptions({ environmentId })
  );
  const certs = certsQuery.data ?? [];

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadFileType, setUploadFileType] = useState<"ca" | "cert" | "key">("cert");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const uploadMutation = useMutation(
    // eslint-disable-next-line react-hooks/refs
    trpc.certificate.upload.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.certificate.list.queryKey({ environmentId }) });
        toast.success("Certificate uploaded");
        resetUploadForm();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to upload certificate", { duration: 6000 });
      },
    })
  );

  const deleteMutation = useMutation(
    trpc.certificate.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.certificate.list.queryKey({ environmentId }) });
        toast.success("Certificate deleted");
        setDeleteTarget(null);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete certificate", { duration: 6000 });
      },
    })
  );

  function resetUploadForm() {
    setUploadOpen(false);
    setUploadName("");
    setUploadFileType("cert");
    setUploadFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const dataBase64 = btoa(text);
      uploadMutation.mutate({
        environmentId,
        name: uploadName,
        filename: uploadFile.name,
        fileType: uploadFileType,
        dataBase64,
      });
    };
    reader.readAsText(uploadFile);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileKey className="h-4 w-4" />
                Certificates
              </CardTitle>
              <CardDescription>
                TLS certificates and private keys for pipeline components.
                Uploaded files are encrypted at rest.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              Upload Certificate
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {certs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
              <FileKey className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No certificates uploaded for this environment
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Upload CA certificates, TLS certificates, or private keys in PEM format
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {certs.map((cert) => (
                  <TableRow key={cert.id}>
                    <TableCell className="font-mono text-sm font-medium">
                      {cert.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {cert.filename}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {FILE_TYPE_LABELS[cert.fileType] ?? cert.fileType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(cert.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        aria-label="Delete certificate"
                        onClick={() => setDeleteTarget({ id: cert.id, name: cert.name })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Upload Certificate Dialog */}
      <Dialog open={uploadOpen} onOpenChange={(open) => { if (!open) resetUploadForm(); else setUploadOpen(true); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Certificate</DialogTitle>
            <DialogDescription>
              Upload a PEM-encoded certificate or private key file. Maximum size: 100KB.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cert-name">Name</Label>
              <Input
                id="cert-name"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
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
              <Select value={uploadFileType} onValueChange={(v) => setUploadFileType(v as "ca" | "cert" | "key")}>
                <SelectTrigger id="cert-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ca">CA Certificate</SelectItem>
                  <SelectItem value="cert">Certificate</SelectItem>
                  <SelectItem value="key">Private Key</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cert-file">File</Label>
              <div className="flex items-center gap-3">
                <Input
                  ref={fileInputRef}
                  id="cert-file"
                  type="file"
                  accept=".pem,.crt,.cert,.key,.ca"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">
                PEM-encoded file (must contain -----BEGIN header)
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetUploadForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={uploadMutation.isPending || !uploadFile}>
                {uploadMutation.isPending ? (
                  <>
                    <Upload className="mr-2 h-3.5 w-3.5 animate-pulse" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-3.5 w-3.5" />
                    Upload
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Certificate"
        description={
          <>
            Permanently delete the certificate{" "}
            <span className="font-mono font-semibold">{deleteTarget?.name}</span>?
            Any pipeline configs referencing this certificate will fail at deploy time.
          </>
        }
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ id: deleteTarget.id, environmentId });
          }
        }}
      />
    </>
  );
}
