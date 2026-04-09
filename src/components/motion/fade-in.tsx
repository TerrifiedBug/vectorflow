"use client";

import type { TargetAndTransition } from "motion/react";
import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { fadeInUp, durations, easings } from "./variants";

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
      initial={fadeInUp.initial as TargetAndTransition}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: durations.normal, ease: easings.enter, delay },
      }}
    >
      {children}
    </m.div>
  );
}
