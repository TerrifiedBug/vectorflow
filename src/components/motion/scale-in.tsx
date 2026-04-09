"use client";

import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { durations, easings } from "./variants";

interface ScaleInProps {
  delay?: number;
  className?: string;
  children: ReactNode;
}

export function ScaleIn({ delay = 0, className, children }: ScaleInProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <m.div
      className={className}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{
        opacity: 1,
        scale: 1,
        transition: { duration: durations.normal, ease: easings.enter, delay },
      }}
    >
      {children}
    </m.div>
  );
}
