import * as React from "react";
import { cn } from "@/lib/utils";

interface VFLogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: number;
  wordmark?: boolean;
  mono?: boolean;
}

export function VFLogo({
  size = 22,
  wordmark = true,
  mono = false,
  className,
  ...props
}: VFLogoProps) {
  return (
    <span
      className={cn("inline-flex items-center leading-none", className)}
      style={{ gap: 9 }}
      {...props}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 28 28"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M14 1.5L25.5 8v12L14 26.5 2.5 20V8L14 1.5z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          opacity="0.55"
        />
        <path
          d="M8 10l6 4 6-4"
          stroke="var(--accent-brand)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8 16l6 4 6-4"
          stroke="var(--accent-brand)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.5"
        />
      </svg>
      {wordmark && (
        <span
          style={{
            fontFamily: mono
              ? 'var(--font-mono)'
              : 'var(--font-sans)',
            fontSize: size * 0.62,
            fontWeight: 600,
            letterSpacing: "-0.015em",
            color: "currentColor",
          }}
        >
          <span style={{ fontWeight: 700 }}>vector</span>
          <span style={{ fontWeight: 400, opacity: 0.85 }}>flow</span>
        </span>
      )}
    </span>
  );
}
