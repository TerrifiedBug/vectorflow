"use client";

import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { durations, easings } from "./variants";

type Direction = "left" | "right" | "up" | "down";

interface SlideInProps {
  direction?: Direction;
  delay?: number;
  className?: string;
  children: ReactNode;
}

function getInitialOffset(direction: Direction): { x?: number; y?: number } {
  switch (direction) {
    case "left":
      return { x: -20 };
    case "right":
      return { x: 20 };
    case "up":
      return { y: -20 };
    case "down":
      return { y: 20 };
  }
}

export function SlideIn({
  direction = "left",
  delay = 0,
  className,
  children,
}: SlideInProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  const offset = getInitialOffset(direction);

  return (
    <m.div
      className={className}
      initial={{ opacity: 0, ...offset }}
      animate={{
        opacity: 1,
        x: 0,
        y: 0,
        transition: { duration: durations.normal, ease: easings.enter, delay },
      }}
    >
      {children}
    </m.div>
  );
}
