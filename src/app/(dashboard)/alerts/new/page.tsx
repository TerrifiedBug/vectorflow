"use client";

import { AlertRuleForm } from "@/components/alerts/alert-rule-form";

/**
 * v2 Alert rule editor (11e) — single-rule create page.
 * Source: docs/internal/VectorFlow 2.0/screens/handoff-surfaces.jsx (ScreenAlertRuleEditor).
 *
 * Form lives in @/components/alerts/alert-rule-form so it can be shared
 * with the /alerts/[id]/edit page.
 */
export default function NewAlertRulePage() {
  return <AlertRuleForm mode="create" />;
}
