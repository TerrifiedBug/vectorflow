"use client";

import { BackupSettings } from "../_components/backup-settings";
import { PageHeader } from "@/components/ui/page-header";

export default function BackupPage() {
  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Backup"
        subtitle="Configure automatic database backups and restore from backup."
      />
      <div className="space-y-4 p-4">
        <BackupSettings />
      </div>
    </div>
  );
}
