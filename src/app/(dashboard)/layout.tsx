"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Bell, BookOpen, LogOut, Search, ShieldAlert, User } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { useSSE } from "@/hooks/use-sse";
import { useRealtimeInvalidation } from "@/hooks/use-realtime-invalidation";
import { useSSEToasts } from "@/hooks/use-sse-toasts";
import { AppSidebar } from "@/components/app-sidebar";
import { TeamSelector } from "@/components/team-selector";
import { EnvironmentSelector } from "@/components/environment-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
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
import { LazyMotionProvider } from "@/components/motion/lazy-motion-provider";
import { UpdateBanner } from "@/components/update-banner";
import { CommandPalette, triggerCommandPalette } from "@/components/command-palette";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts-modal";
import { Search } from "lucide-react";
import { useEnvironmentStore } from "@/stores/environment-store";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  // SSE connection + cache invalidation + toast notifications (fire-and-forget)
  useSSE();
  useRealtimeInvalidation();
  useSSEToasts();

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

  const teamsQuery = useQuery(trpc.team.list.queryOptions());
  const teams = teamsQuery.data ?? [];
  const isTeamless = teamsQuery.isSuccess && teams.length === 0;

  const { selectedEnvironmentId } = useEnvironmentStore();
  const alertStats = useQuery({
    ...trpc.dashboard.stats.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: 60_000,
  });
  const activeAlertCount = alertStats.data?.alerts ?? 0;

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

  if (isTeamless) {
    return (
      <div className="flex min-h-screen flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild aria-label="Documentation">
              <a href="https://terrifiedbug.gitbook.io/vectorflow" target="_blank" rel="noopener noreferrer">
                <BookOpen className="h-5 w-5" />
              </a>
            </Button>
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
                <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main-content" className="flex flex-1 items-center justify-center" tabIndex={-1}>
          <div className="mx-auto max-w-md text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            </div>
            <h1 className="text-2xl font-semibold text-balance">No Team Assigned</h1>
            <p className="text-muted-foreground text-pretty">
              Your account is active but you haven&apos;t been assigned to a team yet. Contact your administrator to get access.
            </p>
            {(userName || userEmail) && (
              <p className="text-sm text-muted-foreground">
                Signed in as <span className="font-medium text-foreground">{userName || userEmail}</span>
              </p>
            )}
            <Button variant="outline" onClick={() => signOut({ callbackUrl: "/login" })}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </main>
        <ChangePasswordDialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen} forced={me?.mustChangePassword} />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4" aria-label="Dashboard header">
          <TeamSelector />
          <Separator orientation="vertical" className="!h-5" />
          <EnvironmentSelector />
          <button
            type="button"
            onClick={triggerCommandPalette}
            className="hidden md:flex items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search...</span>
            <kbd className="pointer-events-none ml-2 inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              <span className="text-xs">&#8984;</span>K
            </kbd>
          </button>
          <div className="ml-auto md:ml-0 flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              asChild
              aria-label={`Alerts${activeAlertCount > 0 ? ` (${activeAlertCount} active)` : ""}`}
            >
              <Link href="/alerts" className="relative">
                <Bell className="h-5 w-5" />
                {activeAlertCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground tabular-nums">
                    {activeAlertCount > 99 ? "99+" : activeAlertCount}
                  </span>
                )}
              </Link>
            </Button>
            <Button variant="ghost" size="icon" asChild aria-label="Documentation">
              <a href="https://terrifiedbug.gitbook.io/vectorflow" target="_blank" rel="noopener noreferrer">
                <BookOpen className="h-5 w-5" />
              </a>
            </Button>
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
        <CommandPalette />
        <KeyboardShortcutsModal />
        <LazyMotionProvider>
          <main id="main-content" className="flex-1 py-2 px-6" tabIndex={-1}>
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>
        </LazyMotionProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
