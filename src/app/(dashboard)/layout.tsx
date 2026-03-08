"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, User } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { AppSidebar } from "@/components/app-sidebar";
import { EnvironmentSelector } from "@/components/environment-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ErrorBoundary } from "@/components/error-boundary";
import { UpdateBanner } from "@/components/update-banner";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  const { data: session } = useSession();
  const trpc = useTRPC();
  const { data: me } = useQuery(trpc.user.me.queryOptions());
  const userName = session?.user?.name;
  const userEmail = session?.user?.email;
  const userImage = session?.user?.image;

  // Extract initials
  const initials = (() => {
    if (userName) {
      const parts = userName.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      return parts[0][0].toUpperCase();
    }
    if (userEmail) return userEmail[0].toUpperCase();
    return "U";
  })();

  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  // Force password change dialog when mustChangePassword is set
  useEffect(() => {
    if (me?.mustChangePassword) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPasswordDialogOpen(true);
    }
  }, [me?.mustChangePassword]);

  // Redirect to dedicated 2FA setup page if required but not enabled
  // Guard: wait for password change to complete first
  useEffect(() => {
    if (me && !me.mustChangePassword && me.twoFactorRequired && !me.totpEnabled && me.authMethod !== "OIDC") {
      router.push("/setup-2fa");
    }
  }, [me, router]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <div className="ml-auto flex items-center gap-2">
            <EnvironmentSelector />
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full" aria-label="User menu">
                  <Avatar size="sm">
                    {userImage && <AvatarImage src={userImage} alt={userName ?? "User"} />}
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{userName ?? "User"}</p>
                    {userEmail && (
                      <p className="text-xs leading-none text-muted-foreground">{userEmail}</p>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <User className="mr-2 h-4 w-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => signOut({ callbackUrl: "/login" })}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <ChangePasswordDialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen} forced={me?.mustChangePassword} />
        <UpdateBanner />
        <div className="flex-1 py-2 px-6">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
