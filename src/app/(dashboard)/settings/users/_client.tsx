"use client";

import { AccessSettingsShell } from "../_components/access-settings-shell";
import { UsersSettings } from "../_components/users-settings";

export default function UsersPage() {
  return (
    <AccessSettingsShell active="users">
      <UsersSettings />
    </AccessSettingsShell>
  );
}
