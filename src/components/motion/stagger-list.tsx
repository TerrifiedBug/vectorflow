"use client";

import React from "react";
import type { JSX, ComponentPropsWithoutRef } from "react";
import * as m from "motion/react-m";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/* ------------------------------------------------------------------ */
/*  Polymorphic element tag — union of all HTML element keys in m.*    */
/* ------------------------------------------------------------------ */

type ValidTag = keyof JSX.IntrinsicElements;

/* ------------------------------------------------------------------ */
/*  StaggerList                                                        */
/* ------------------------------------------------------------------ */

type StaggerListProps<T extends ValidTag = "div"> = {
  as?: T;
  className?: string;
  children: React.ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "className" | "children">;

const staggerListVariants = (childCount: number) => ({
  hidden: {},
  visible: {
    transition: {
      staggerChildren: Math.min(0.03, 0.3 / Math.max(childCount, 1)),
    },
  },
});

export function StaggerList<T extends ValidTag = "div">({
  as,
  className,
  children,
  ...rest
}: StaggerListProps<T>) {
  const shouldReduceMotion = useReducedMotion();
  const tag = (as ?? "div") as string;
  const childCount = React.Children.count(children);

  if (shouldReduceMotion) {
    const Element = tag as unknown as React.ElementType;
    return (
      <Element className={className} {...rest}>
        {children}
      </Element>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MotionComponent = (m as any)[tag];

  if (!MotionComponent) {
    const Element = tag as unknown as React.ElementType;
    return (
      <Element className={className} {...rest}>
        {children}
      </Element>
    );
  }

  return (
    <MotionComponent
      className={className}
      variants={staggerListVariants(childCount)}
      initial="hidden"
      animate="visible"
      {...rest}
    >
      {children}
    </MotionComponent>
  );
}

/* ------------------------------------------------------------------ */
/*  StaggerItem                                                        */
/* ------------------------------------------------------------------ */

type StaggerItemProps<T extends ValidTag = "div"> = {
  as?: T;
  className?: string;
  children?: React.ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "className" | "children">;

const staggerItemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2 },
  },
};

export function StaggerItem<T extends ValidTag = "div">({
  as,
  className,
  children,
  ...rest
}: StaggerItemProps<T>) {
  const shouldReduceMotion = useReducedMotion();
  const tag = (as ?? "div") as string;

  if (shouldReduceMotion) {
    const Element = tag as unknown as React.ElementType;
    return (
      <Element className={className} {...rest}>
        {children}
      </Element>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MotionComponent = (m as any)[tag];

  if (!MotionComponent) {
    const Element = tag as unknown as React.ElementType;
    return (
      <Element className={className} {...rest}>
        {children}
      </Element>
    );
  }

  return (
    <MotionComponent
      className={className}
      variants={staggerItemVariants}
      {...rest}
    >
      {children}
    </MotionComponent>
  );
}
