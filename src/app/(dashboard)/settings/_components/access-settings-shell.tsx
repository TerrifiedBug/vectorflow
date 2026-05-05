import Link from "next/link";
import { Check, ShieldCheck, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TABS = [
  { id: "users", label: "Users", href: "/settings/users", icon: Users },
  { id: "roles", label: "Roles", href: "/settings/roles", icon: ShieldCheck },
  { id: "sso", label: "SSO", href: "/settings/auth", icon: ShieldCheck },
] as const;

export function AccessSettingsShell({
  active,
  children,
}: {
  active: "users" | "roles" | "sso";
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5 bg-bg text-fg">
      <div className="border-b border-line pb-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-fg-2">settings / access</div>
        <h1 className="mt-1 font-mono text-[22px] font-medium tracking-[-0.01em] text-fg">Users, roles & SSO</h1>
        <p className="mt-2 max-w-[760px] text-[12px] leading-relaxed text-fg-1">
          Manage human access, role permissions, and identity-provider mapping across VectorFlow.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-[3px] border border-line bg-bg-2 p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-[3px] px-3 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors",
                isActive ? "bg-bg-3 text-fg shadow-[inset_0_-2px_0_var(--accent-brand)]" : "text-fg-2 hover:bg-bg-3/60 hover:text-fg",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}

const PERMISSIONS = [
  { name: "View dashboards and audit logs", viewer: true, editor: true, admin: true, owner: true },
  { name: "Create and edit draft pipelines", viewer: false, editor: true, admin: true, owner: true },
  { name: "Deploy pipelines", viewer: false, editor: true, admin: true, owner: true },
  { name: "Manage environments and secrets", viewer: false, editor: false, admin: true, owner: true },
  { name: "Invite and remove team members", viewer: false, editor: false, admin: true, owner: true },
  { name: "Configure SSO and platform users", viewer: false, editor: false, admin: false, owner: true },
] as const;

export function RolesMatrix() {
  const roles = ["viewer", "editor", "admin", "owner"] as const;
  return (
    <AccessSettingsShell active="roles">
      <Card className="border-line bg-bg-2">
        <CardHeader className="border-b border-line bg-bg-1 py-3">
          <CardTitle className="font-mono text-[14px] font-medium">Role permissions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line bg-bg-1">
                  <th className="h-9 px-3 text-left font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-fg-2">Permission</th>
                  {roles.map((role) => (
                    <th key={role} className="h-9 px-3 text-center font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-fg-2">{role}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((permission) => (
                  <tr key={permission.name} className="border-b border-line last:border-b-0">
                    <td className="h-10 px-3 text-[12px] text-fg-1">{permission.name}</td>
                    {roles.map((role) => (
                      <td key={role} className="h-10 px-3 text-center">
                        {permission[role] ? (
                          <Check className="mx-auto h-4 w-4 text-accent-brand" aria-label="Allowed" />
                        ) : (
                          <X className="mx-auto h-4 w-4 text-fg-3" aria-label="Not allowed" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </AccessSettingsShell>
  );
}
