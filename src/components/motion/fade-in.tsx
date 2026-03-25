"use client";

import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

interface FadeInProps {
  className?: string;
  children: ReactNode;
  /** Optional delay in seconds before the animation starts. */
  delay?: number;
}

export function FadeIn({ className, children, delay = 0 }: FadeInProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay }}
    >
      {children}
    </m.div>
  );
}
