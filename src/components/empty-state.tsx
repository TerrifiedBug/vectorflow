'use client';

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion";
import { cn } from "@/lib/utils";

interface HelperLine {
  icon?: string;
  text: React.ReactNode;
  muted?: boolean;
}

interface EmptyStateProps {
  /** Optional Lucide icon component */
  icon?: LucideIcon;
  /** Optional glyph string (e.g. "◇") for the v2 64px tile */
  glyph?: string;
  title: string;
  description?: React.ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  secondary?: { label: string; href?: string; onClick?: () => void };
  helperLines?: HelperLine[];
  /** Compact dashed-border layout (legacy) */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  glyph,
  title,
  description,
  action,
  secondary,
  helperLines,
  compact = false,
  className,
}: EmptyStateProps) {
  if (compact) {
    return (
      <FadeIn>
        <div
          className={cn(
            "flex flex-col items-center justify-center rounded-md border border-dashed border-line-2 p-8 text-center",
            className,
          )}
        >
          {Icon && <Icon className="h-8 w-8 text-fg-2 mb-3" />}
          <p className="text-fg text-[13px] font-medium text-balance">{title}</p>
          {description && (
            <p className="mt-1.5 text-[12px] text-fg-2 text-pretty">{description}</p>
          )}
          {action && (
            <Button asChild={!!action.href} onClick={action.onClick} className="mt-3" variant="outline" size="sm">
              {action.href ? <Link href={action.href}>{action.label}</Link> : action.label}
            </Button>
          )}
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn>
      <div className={cn("flex items-center justify-center p-10 min-h-[60vh]", className)}>
        <div className="w-[540px] text-center">
          <div className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-xl bg-bg-2 border border-line-2 text-accent-brand font-mono text-[28px]">
            {glyph || (Icon ? <Icon className="h-7 w-7" /> : "◇")}
          </div>
          <h2 className="m-0 font-mono text-[22px] font-medium tracking-[-0.02em] text-fg">{title}</h2>
          {description && (
            <p className="mt-2.5 mx-auto max-w-[460px] text-[13.5px] text-fg-1 leading-relaxed">{description}</p>
          )}

          {helperLines && helperLines.length > 0 && (
            <div className="mt-5 p-3.5 bg-bg-2 border border-line rounded-md font-mono text-[11.5px] leading-[1.7] text-fg-1 text-left">
              {helperLines.map((line, i) => (
                <div key={i} className="flex gap-2 items-baseline">
                  <span className="text-accent-brand">{line.icon || "$"}</span>
                  <span className={line.muted ? "text-fg-2" : "text-fg"}>{line.text}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 flex gap-2.5 justify-center">
            {secondary && (
              <Button
                variant="ghost"
                size="md"
                asChild={!!secondary.href}
                onClick={secondary.onClick}
              >
                {secondary.href ? <Link href={secondary.href}>{secondary.label}</Link> : secondary.label}
              </Button>
            )}
            {action && (
              <Button
                variant="primary"
                size="md"
                asChild={!!action.href}
                onClick={action.onClick}
              >
                {action.href ? <Link href={action.href}>{action.label}</Link> : action.label}
              </Button>
            )}
          </div>
        </div>
      </div>
    </FadeIn>
  );
}
