import * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
  breadcrumb,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "px-6 py-5 border-b border-line bg-bg flex items-end gap-4",
        className,
      )}
    >
      <div className="flex-1 min-w-0">
        {breadcrumb && (
          <div className="font-mono text-[11px] text-fg-2 mb-1.5 flex items-center gap-1.5">
            {breadcrumb}
          </div>
        )}
        <h1 className="m-0 font-mono text-[22px] font-medium tracking-[-0.02em] text-fg leading-tight">
          {title}
        </h1>
        {subtitle && (
          <div className="mt-1 text-[12px] text-fg-1 leading-snug max-w-3xl">
            {subtitle}
          </div>
        )}
        {meta && (
          <div className="mt-2 flex items-center gap-2.5 text-[11px] font-mono text-fg-2 flex-wrap">
            {meta}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function PageHeaderMetaSep() {
  return <span className="text-fg-3">·</span>;
}
