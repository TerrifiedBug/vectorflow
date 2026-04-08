'use client';

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; href: string };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <FadeIn>
      <div
        className={cn(
          "flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center",
          className,
        )}
      >
        {Icon && <Icon className="h-10 w-10 text-muted-foreground mb-3" />}
        <p className="text-muted-foreground text-balance">{title}</p>
        {description && (
          <p className="mt-2 text-xs text-muted-foreground text-pretty">{description}</p>
        )}
        {action && (
          <Button asChild className="mt-4" variant="outline">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )}
      </div>
    </FadeIn>
  );
}
