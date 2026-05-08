"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
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

const NONE_VALUE = "__none__";

export interface BundleDialogEnvironmentOption {
  id: string;
  name: string;
}

export interface BundleDialogCertificateOption {
  id: string;
  name: string;
  filename: string;
  fileType: "ca" | "cert" | "key";
}

export interface BundleDialogValue {
  environmentId: string;
  name: string;
  caId: string | null;
  certId: string | null;
  keyId: string | null;
}

interface CertificateBundleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  submitLabel: string;
  isPending: boolean;
  environments: BundleDialogEnvironmentOption[];
  certificatesByEnvironment: Record<string, BundleDialogCertificateOption[]>;
  initialValue?: BundleDialogValue | null;
  environmentLocked?: boolean;
  onSubmit: (value: BundleDialogValue) => void;
}

function emptyValue(environmentId: string): BundleDialogValue {
  return {
    environmentId,
    name: "",
    caId: null,
    certId: null,
    keyId: null,
  };
}

export function CertificateBundleDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  isPending,
  environments,
  certificatesByEnvironment,
  initialValue,
  environmentLocked = false,
  onSubmit,
}: CertificateBundleDialogProps) {
  const defaultEnvironmentId = initialValue?.environmentId ?? environments[0]?.id ?? "";
  const [formValue, setFormValue] = React.useState<BundleDialogValue>(
    initialValue ?? emptyValue(defaultEnvironmentId),
  );

  React.useEffect(() => {
    if (!open) return;
    setFormValue(initialValue ?? emptyValue(defaultEnvironmentId));
  }, [open, initialValue, defaultEnvironmentId]);

  const certificates = certificatesByEnvironment[formValue.environmentId] ?? [];
  const caOptions = certificates.filter((certificate) => certificate.fileType === "ca");
  const certOptions = certificates.filter((certificate) => certificate.fileType === "cert");
  const keyOptions = certificates.filter((certificate) => certificate.fileType === "key");

  const setField = <K extends keyof BundleDialogValue>(field: K, value: BundleDialogValue[K]) => {
    setFormValue((current) => ({ ...current, [field]: value }));
  };

  const handleEnvironmentChange = (environmentId: string) => {
    setFormValue((current) => ({
      ...current,
      environmentId,
      caId: null,
      certId: null,
      keyId: null,
    }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!formValue.environmentId || !formValue.name.trim()) return;
    onSubmit({
      environmentId: formValue.environmentId,
      name: formValue.name.trim(),
      caId: formValue.caId,
      certId: formValue.certId,
      keyId: formValue.keyId,
    });
  };

  const renderCertificateOption = (certificate: BundleDialogCertificateOption) => (
    <SelectItem key={certificate.id} value={certificate.id}>
      {certificate.name} ({certificate.filename})
    </SelectItem>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bundle-environment">Environment</Label>
            <Select
              value={formValue.environmentId}
              onValueChange={handleEnvironmentChange}
              disabled={environmentLocked || environments.length === 0}
            >
              <SelectTrigger id="bundle-environment">
                <SelectValue placeholder="Select environment" />
              </SelectTrigger>
              <SelectContent>
                {environments.map((environment) => (
                  <SelectItem key={environment.id} value={environment.id}>
                    {environment.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bundle-name">Name</Label>
            <Input
              id="bundle-name"
              value={formValue.name}
              onChange={(event) => setField("name", event.target.value)}
              placeholder="mtls-prod"
              pattern="^[a-zA-Z0-9][a-zA-Z0-9_-]*$"
              required
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Start with a letter or number. Only letters, numbers, hyphens, and underscores.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="bundle-ca">CA Certificate</Label>
              <Select
                value={formValue.caId ?? NONE_VALUE}
                onValueChange={(value) => setField("caId", value === NONE_VALUE ? null : value)}
              >
                <SelectTrigger id="bundle-ca">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>None</SelectItem>
                  {caOptions.map(renderCertificateOption)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bundle-cert">Certificate</Label>
              <Select
                value={formValue.certId ?? NONE_VALUE}
                onValueChange={(value) => setField("certId", value === NONE_VALUE ? null : value)}
              >
                <SelectTrigger id="bundle-cert">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>None</SelectItem>
                  {certOptions.map(renderCertificateOption)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bundle-key">Private Key</Label>
              <Select
                value={formValue.keyId ?? NONE_VALUE}
                onValueChange={(value) => setField("keyId", value === NONE_VALUE ? null : value)}
              >
                <SelectTrigger id="bundle-key">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>None</SelectItem>
                  {keyOptions.map(renderCertificateOption)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !formValue.environmentId || !formValue.name.trim()}>
              {isPending ? `${submitLabel}...` : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
