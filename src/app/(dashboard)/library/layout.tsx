"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { FileText, Link2 } from "lucide-react";

const libraryNavItems = [
  { title: "Templates", href: "/library/templates", icon: FileText },
  { title: "Shared Components", href: "/library/shared-components", icon: Link2 },
];

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-background">
        <div className="p-4">
          <h2 className="text-lg font-semibold">Library</h2>
          <p className="text-xs text-muted-foreground">Reusable templates and components</p>
        </div>
        <nav className="flex-1 space-y-1 px-3 pb-4">
          {libraryNavItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.title}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
