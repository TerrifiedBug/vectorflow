"use client";

import React from "react";
import type { JSX, ComponentPropsWithoutRef, Ref } from "react";
import * as m from "motion/react-m";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { staggerContainer, staggerItem } from "./variants";

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
      variants={staggerContainer(childCount)}
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
  ref?: Ref<HTMLElement>;
} & Omit<ComponentPropsWithoutRef<T>, "className" | "children">;

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
      variants={staggerItem}
      {...rest}
    >
      {children}
    </MotionComponent>
  );
}
