"use client";

import {
  AlertRuleForm,
  formValuesFromSearchParams,
} from "@/components/alerts/alert-rule-form";
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
  const hasParams = searchParams.toString().length > 0;

  if (!hasParams) {
    return <AlertRuleForm mode="create" />;
  }

  return (
    <AlertRuleForm
      mode="create"
      initialValues={formValuesFromSearchParams(searchParams)}
      environmentId={searchParams.get("environmentId") ?? undefined}
    />
  );
}
