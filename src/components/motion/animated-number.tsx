'use client';

import { useRef, useEffect } from 'react';
import {
  useMotionValue,
  useSpring,
  useTransform,
} from 'motion/react';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

export interface AnimatedNumberProps {
  /** The numeric value to display and animate to. */
  value: number;
  /** Optional formatter — receives the current value (already `Math.round()`-ed) and returns a display string. */
  formatter?: (roundedValue: number) => string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Inner component — all motion hooks live here so the outer component can
// call useReducedMotion() unconditionally and branch on the result without
// violating the Rules of Hooks.
// ---------------------------------------------------------------------------

function AnimatedNumberInner({
  value,
  formatter,
  className,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(value);
  const springValue = useSpring(motionValue, { stiffness: 80, damping: 20 });
  const displayValue = useTransform(springValue, (v) =>
    formatter ? formatter(Math.round(v)) : String(Math.round(v)),
  );

  // Keep the motion value in sync when the prop changes.
  useEffect(() => {
    motionValue.set(value);
  }, [motionValue, value]);

  // Write DOM updates directly to avoid triggering React re-renders per frame.
  useEffect(() => {
    const unsubscribe = displayValue.on('change', (v) => {
      if (ref.current) {
        ref.current.textContent = v;
      }
    });
    return unsubscribe;
  }, [displayValue]);

  // Use the spring's current position so there's no flash to the final
  // value before the count-up animation starts.
  const initial = formatter
    ? formatter(Math.round(springValue.get()))
    : String(Math.round(springValue.get()));

  return (
    <span ref={ref} className={className}>
      {initial}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Public shell component
// ---------------------------------------------------------------------------

export function AnimatedNumber(props: AnimatedNumberProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    const formatted = props.formatter
      ? props.formatter(Math.round(props.value))
      : String(Math.round(props.value));
    return <span className={props.className}>{formatted}</span>;
  }

  return <AnimatedNumberInner {...props} />;
}

AnimatedNumber.displayName = 'AnimatedNumber';
