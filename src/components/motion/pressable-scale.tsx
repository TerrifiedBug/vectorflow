"use client";

import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { springTransition } from "./variants";

interface PressableScaleProps {
  children: ReactNode;
  className?: string;
  /** Scale factor on hover. Defaults to 1.02. */
  hoverScale?: number;
  /** Render as div or span. Defaults to 'div'. */
  as?: "div" | "span";
}

/**
 * Adds spring-based hover scale feedback to any child element.
 *
 * D003 pattern: checks useReducedMotion → falls back to plain element → uses
 * m.div/m.span from motion/react-m for lazy-loaded motion.
 *
 * Does NOT add whileTap — the base Button CSS already handles active:scale-[0.96].
 */
export function PressableScale({
  children,
  className,
  hoverScale = 1.02,
  as = "div",
}: PressableScaleProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    if (as === "span") {
      return <span className={className}>{children}</span>;
    }
    return <div className={className}>{children}</div>;
  }

  if (as === "span") {
    return (
      <m.span
        className={className}
        whileHover={{ scale: hoverScale, transition: springTransition }}
      >
        {children}
      </m.span>
    );
  }

  return (
    <m.div
      className={className}
      whileHover={{ scale: hoverScale, transition: springTransition }}
    >
      {children}
    </m.div>
  );
}
