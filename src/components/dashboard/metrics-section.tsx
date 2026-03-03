"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface MetricsSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function MetricsSection({
  title,
  defaultOpen = true,
  children,
}: MetricsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform",
            !open && "-rotate-90"
          )}
        />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
