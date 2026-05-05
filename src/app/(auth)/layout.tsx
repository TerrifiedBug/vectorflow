"use client";

import { LazyMotionProvider } from "@/components/motion/lazy-motion-provider";
import { StaggerItem, StaggerList } from "@/components/motion";
import { VFLogo } from "@/components/ui/vf-logo";
import { VFIcon } from "@/components/ui/vf-icon";
import { StatusDot } from "@/components/ui/status-dot";

/**
 * v2 auth shell — two-pane: brand left, form right.
 * Designed per docs/internal/VectorFlow 2.0/screens/other-screens.jsx (ScreenLogin).
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen w-full bg-bg text-fg font-sans overflow-hidden">
      {/* dot grid background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(var(--line-2) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <LazyMotionProvider>
      {/* Left brand pane */}
      <div className="hidden md:flex relative z-10 flex-1 flex-col justify-between p-10 border-r border-line">
        <div className="text-fg">
          <VFLogo size={26} />
        </div>

        <StaggerList>
          <StaggerItem className="font-mono text-[11px] text-accent-brand uppercase tracking-[0.08em] mb-3.5">
            v2.0 · self-hosted
          </StaggerItem>
          <StaggerItem as="h1" className="m-0 text-[38px] font-semibold tracking-[-0.025em] text-fg leading-tight max-w-[520px]">
            Your fleet,<br />
            under one <span className="text-accent-brand">canvas</span>.
          </StaggerItem>
          <StaggerItem as="p" className="mt-4 text-[14px] text-fg-1 max-w-[460px] leading-relaxed">
            Build, deploy, and observe every Vector agent from a single visual control plane. Self-hosted · AGPL-3.0 · agent-driven.
          </StaggerItem>
        </StaggerList>

        <div className="flex gap-6 font-mono text-[11px] text-fg-2">
          <span className="inline-flex items-center gap-1.5">
            <VFIcon name="shield" size={12} />
            self-hosted
          </span>
          <span className="inline-flex items-center gap-1.5">
            <VFIcon name="git" size={12} />
            open source · AGPL
          </span>
          <span className="inline-flex items-center gap-1.5">
            <StatusDot variant="healthy" /> all systems normal
          </span>
        </div>
      </div>

      {/* Right form pane */}
      <div className="relative z-10 w-full md:w-[460px] flex flex-col justify-center p-10 bg-bg-1 border-l border-line">
        {/* Mobile-only header */}
        <div className="md:hidden mb-6">
          <VFLogo size={22} />
        </div>
        {children}
      </div>
      </LazyMotionProvider>
    </div>
  );
}
