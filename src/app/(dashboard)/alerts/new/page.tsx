"use client";

import * as React from "react";
import {
  AlertRuleForm,
  formValuesFromSearchParams,
} from "@/components/alerts/alert-rule-form";
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


  React.useEffect(() => {
    if (environmentId && selectedEnvironmentId !== environmentId) {
      setSelectedEnvironmentId(environmentId);
    }
  }, [environmentId, selectedEnvironmentId, setSelectedEnvironmentId]);

  if (environmentId && selectedEnvironmentId !== environmentId) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-bg text-fg p-8">
        <div className="font-mono text-[12px] text-fg-2">Loading alert rule environment…</div>
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
