"use client";

import type { TargetAndTransition } from "motion/react";
import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { pageEnter } from "./variants";

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

export function PageTransition({ children, className }: PageTransitionProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <>{children}</>;
  }

  return (
    <m.div
      className={className}
      initial={pageEnter.initial as TargetAndTransition}
      animate={pageEnter.animate as TargetAndTransition}
    >
      {children}
    </m.div>
  );
}
