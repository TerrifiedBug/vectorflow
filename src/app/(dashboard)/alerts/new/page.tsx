"use client";

import * as React from "react";
import {
  AlertRuleForm,
  formValuesFromSearchParams,
} from "@/components/alerts/alert-rule-form";
import { VFIcon } from "@/components/ui/vf-icon";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useSearchParams } from "next/navigation";


/**
 * v2 Alert rule editor (11e) — single-rule create page.
 * Source: docs/internal/VectorFlow 2.0/screens/handoff-surfaces.jsx (ScreenAlertRuleEditor).
 *
 * Form lives in @/components/alerts/alert-rule-form so it can be shared
 * with the /alerts/[id]/edit page.
 */
export default function NewAlertRulePage() {
  const searchParams = useSearchParams();
  const setSelectedEnvironmentId = useEnvironmentStore((s) => s.setSelectedEnvironmentId);
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);
  const environmentId = searchParams.get("environmentId") ?? undefined;
  const hasParams = searchParams.toString().length > 0;
  const didSyncEnvironmentRef = React.useRef(false);
  const [didSyncEnvironment, setDidSyncEnvironment] = React.useState(false);


  React.useEffect(() => {
    if (!environmentId) {
      return;
    }

    if (!didSyncEnvironmentRef.current && selectedEnvironmentId !== environmentId) {
      setSelectedEnvironmentId(environmentId);
      return;
    }

    if (selectedEnvironmentId === environmentId) {
      didSyncEnvironmentRef.current = true;
      setDidSyncEnvironment(true);
    }
  }, [environmentId, selectedEnvironmentId, setSelectedEnvironmentId]);

  if (environmentId && !didSyncEnvironment && selectedEnvironmentId !== environmentId) {
    return (
      <div className="flex h-full items-center justify-center bg-bg p-8 text-fg">
        <div className="w-full max-w-[720px] rounded-[3px] border border-line bg-bg-2">
          <div className="flex items-center gap-2 border-b border-line bg-bg-1 px-4 py-3">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-[3px] border border-line bg-bg-2 text-fg-1">
              <VFIcon name="bell" size={13} />
            </span>
            <div>
              <div className="font-mono text-[12px] font-medium text-fg">Alert rule preview</div>
              <div className="text-[11.5px] text-fg-2">Environment context is syncing</div>
            </div>
          </div>
          <div className="grid gap-3 p-4">
            <div className="h-8 rounded-[3px] bg-bg-3" />
            <div className="h-24 rounded-[3px] border border-dashed border-line bg-bg-1" />
            <div className="flex justify-end gap-2">
              <div className="h-8 w-24 rounded-[3px] bg-bg-3" />
              <div className="h-8 w-32 rounded-[3px] bg-accent-soft" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!hasParams) {
    return <AlertRuleForm mode="create" />;
  }

  return (
    <AlertRuleForm
      mode="create"
      initialValues={formValuesFromSearchParams(searchParams)}
    />
  );
}
