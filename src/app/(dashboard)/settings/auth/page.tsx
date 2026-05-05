"use client";

import { AccessSettingsShell } from "../_components/access-settings-shell";
import { AuthSettings } from "../_components/auth-settings";

export default function AuthPage() {
  return (
    <AccessSettingsShell active="sso">
      <AuthSettings />
    </AccessSettingsShell>
  );
}
