import type { Variants } from "motion/react";

/* ------------------------------------------------------------------ */
/*  Easing curves                                                       */
/* ------------------------------------------------------------------ */

export const easings = {
  /** Standard enter: ease-in-out */
  enter: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
  /** Standard exit: accelerate out */
  exit: [0.4, 0, 1, 1] as [number, number, number, number],
} as const;

/* ------------------------------------------------------------------ */
/*  Duration presets (seconds)                                          */
/* ------------------------------------------------------------------ */

export const durations = {
  fast: 0.15,
  normal: 0.2,
  slow: 0.3,
  page: 0.35,
} as const;

/* ------------------------------------------------------------------ */
/*  Named variant presets                                               */
/* ------------------------------------------------------------------ */

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: durations.normal, ease: easings.enter },
  },
};

export const fadeInUp: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: durations.normal, ease: easings.enter },
  },
};

export const slideInLeft: Variants = {
  initial: { opacity: 0, x: -20 },
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: durations.normal, ease: easings.enter },
  },
};

export const slideInRight: Variants = {
  initial: { opacity: 0, x: 20 },
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: durations.normal, ease: easings.enter },
  },
};

export const slideInUp: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: durations.normal, ease: easings.enter },
  },
};

export const slideInDown: Variants = {
  initial: { opacity: 0, y: -20 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: durations.normal, ease: easings.enter },
  },
};

export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: durations.normal, ease: easings.enter },
  },
};

/** Returns container variants that stagger children proportionally. */
export function staggerContainer(childCount: number): Variants {
  return {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: Math.min(0.03, 0.3 / Math.max(childCount, 1)),
      },
    },
  };
}

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: durations.normal, ease: easings.enter },
  },
};

export const pageEnter: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: durations.page, ease: easings.enter },
  },
};

export const pageExit: Variants = {
  initial: { opacity: 1, y: 0 },
  animate: {
    opacity: 0,
    y: -6,
    transition: { duration: durations.fast, ease: easings.exit },
  },
};
