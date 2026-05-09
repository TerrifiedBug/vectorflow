"use client";

import { AccessSettingsShell } from "../_components/access-settings-shell";
import { AuthSettings } from "../_components/auth-settings";

export default function SsoPage() {
  return (
    <AccessSettingsShell active="sso">
      <AuthSettings />
    </AccessSettingsShell>
  );
}
