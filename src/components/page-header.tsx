import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, meta, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-end justify-between gap-4 border-b border-line px-6 py-5", className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="font-mono text-[22px] font-medium leading-tight tracking-[-0.02em] text-fg text-balance">{title}</h1>
        {description && (
          <p className="max-w-3xl text-[12px] leading-snug text-fg-1 text-pretty">{description}</p>
        )}
        {meta && (
          <div className="flex flex-wrap items-center gap-2.5 pt-1 font-mono text-[11px] text-fg-2">
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
