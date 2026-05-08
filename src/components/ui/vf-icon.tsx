import * as React from "react";
import { cn } from "@/lib/utils";

export type VFIconName =
  | "dashboard" | "pipelines" | "fleet" | "env" | "templates" | "audit"
  | "alerts" | "settings" | "search" | "plus" | "play" | "pause"
  | "deploy" | "check" | "x" | "chevron-down" | "chevron-right" | "chevron-left"
  | "arrow-right" | "arrow-up" | "arrow-down" | "circle" | "dot" | "menu"
  | "more" | "filter" | "cmd" | "cpu" | "mem" | "disk" | "net" | "globe"
  | "shield" | "key" | "user" | "team" | "clock" | "box" | "list" | "grid"
  | "eye" | "bolt" | "database" | "terminal" | "git" | "rotate" | "spark"
  | "split" | "sun" | "moon" | "zap" | "bell" | "bell-off" | "trash"
  | "external-link" | "edit" | "copy" | "rocket" | "git-branch" | "rotate-cw"
  | "rotate-ccw" | "download" | "upload" | "arrow-up-down";

interface VFIconProps extends React.SVGAttributes<SVGElement> {
  name: VFIconName;
  size?: number;
  strokeWidth?: number;
}

export function VFIcon({
  name,
  size = 16,
  strokeWidth = 1.5,
  className,
  ...props
}: VFIconProps) {
  const baseProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": "true" as const,
    className: cn("shrink-0", className),
    ...props,
  };

  switch (name) {
    case "dashboard":
      return (
        <svg {...baseProps}>
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
      );
    case "pipelines":
      return (
        <svg {...baseProps}>
          <circle cx="5" cy="6" r="2" />
          <circle cx="19" cy="6" r="2" />
          <circle cx="12" cy="18" r="2" />
          <path d="M7 6h10M6 8l5 8M18 8l-5 8" />
        </svg>
      );
    case "fleet":
      return (
        <svg {...baseProps}>
          <rect x="3" y="4" width="18" height="5" rx="1" />
          <rect x="3" y="11" width="18" height="5" rx="1" />
          <rect x="3" y="18" width="18" height="3" rx="1" />
          <circle cx="6.5" cy="6.5" r=".5" fill="currentColor" />
          <circle cx="6.5" cy="13.5" r=".5" fill="currentColor" />
        </svg>
      );
    case "env":
      return (
        <svg {...baseProps}>
          <path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" />
          <path d="M3 7l9 4 9-4M12 11v10" />
        </svg>
      );
    case "templates":
      return (
        <svg {...baseProps}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 21V9" />
        </svg>
      );
    case "audit":
      return (
        <svg {...baseProps}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M9 13h6M9 17h6" />
        </svg>
      );
    case "alerts":
    case "bell":
      return (
        <svg {...baseProps}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
      );
    case "bell-off":
      return (
        <svg {...baseProps}>
          <path d="M8.7 3A6 6 0 0 1 18 8c0 1.5.2 2.7.5 3.7M19.7 19.7A2 2 0 0 1 18 21H3s3-2 3-9" />
          <path d="M10 21a2 2 0 0 0 4 0M2 2l20 20" />
        </svg>
      );
    case "settings":
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case "search":
      return (
        <svg {...baseProps}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      );
    case "plus":
      return (
        <svg {...baseProps}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "play":
      return (
        <svg {...baseProps}>
          <path d="M8 5v14l11-7z" fill="currentColor" />
        </svg>
      );
    case "pause":
      return (
        <svg {...baseProps}>
          <rect x="6" y="5" width="4" height="14" fill="currentColor" />
          <rect x="14" y="5" width="4" height="14" fill="currentColor" />
        </svg>
      );
    case "deploy":
    case "rocket":
      return (
        <svg {...baseProps}>
          <path d="M5 12l7-7 7 7M12 5v14" />
        </svg>
      );
    case "check":
      return (
        <svg {...baseProps}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      );
    case "x":
      return (
        <svg {...baseProps}>
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...baseProps}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...baseProps}>
          <path d="M9 18l6-6-6-6" />
        </svg>
      );
    case "chevron-left":
      return (
        <svg {...baseProps}>
          <path d="M15 18l-6-6 6-6" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...baseProps}>
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg {...baseProps}>
          <path d="M7 17L17 7M7 7h10v10" />
        </svg>
      );
    case "arrow-down":
      return (
        <svg {...baseProps}>
          <path d="M17 7L7 17M17 17H7V7" />
        </svg>
      );
    case "arrow-up-down":
      return (
        <svg {...baseProps}>
          <path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3" />
        </svg>
      );
    case "circle":
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="4" fill="currentColor" />
        </svg>
      );
    case "dot":
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      );
    case "menu":
      return (
        <svg {...baseProps}>
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      );
    case "more":
      return (
        <svg {...baseProps}>
          <circle cx="5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="19" cy="12" r="1.5" fill="currentColor" />
        </svg>
      );
    case "filter":
      return (
        <svg {...baseProps}>
          <path d="M22 3H2l8 9.46V19l4 2v-8.54z" />
        </svg>
      );
    case "cmd":
      return (
        <svg {...baseProps}>
          <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
        </svg>
      );
    case "cpu":
      return (
        <svg {...baseProps}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
        </svg>
      );
    case "mem":
      return (
        <svg {...baseProps}>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M6 10v4M10 10v4M14 10v4M18 10v4" />
        </svg>
      );
    case "disk":
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "net":
      return (
        <svg {...baseProps}>
          <path d="M2 12h20M12 2c2.5 3 4 6.5 4 10s-1.5 7-4 10c-2.5-3-4-6.5-4-10s1.5-7 4-10z" />
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
    case "globe":
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
    case "shield":
      return (
        <svg {...baseProps}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case "key":
      return (
        <svg {...baseProps}>
          <circle cx="8" cy="15" r="4" />
          <path d="M10.5 12.5L19 4M16 7l3 3" />
        </svg>
      );
    case "user":
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
        </svg>
      );
    case "team":
      return (
        <svg {...baseProps}>
          <circle cx="9" cy="8" r="4" />
          <circle cx="17" cy="9" r="3" />
          <path d="M2 21c0-4 3-7 7-7s7 3 7 7M16 14c3 0 6 2 6 6" />
        </svg>
      );
    case "clock":
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "box":
      return (
        <svg {...baseProps}>
          <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <path d="M3.3 7l8.7 5 8.7-5M12 22V12" />
        </svg>
      );
    case "list":
      return (
        <svg {...baseProps}>
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      );
    case "grid":
      return (
        <svg {...baseProps}>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      );
    case "eye":
      return (
        <svg {...baseProps}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "bolt":
    case "zap":
      return (
        <svg {...baseProps}>
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      );
    case "database":
      return (
        <svg {...baseProps}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...baseProps}>
          <path d="M4 17l6-6-6-6M12 19h8" />
        </svg>
      );
    case "git":
    case "git-branch":
      return (
        <svg {...baseProps}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="12" cy="18" r="2" />
          <path d="M6 8v8a4 4 0 0 0 4 4h0M18 8a4 4 0 0 1-4 4h-2" />
        </svg>
      );
    case "rotate":
    case "rotate-cw":
      return (
        <svg {...baseProps}>
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
        </svg>
      );
    case "rotate-ccw":
      return (
        <svg {...baseProps}>
          <path d="M3 8L6 5.3A9 9 0 0 1 21 12M3 3v5h5M21 16a9 9 0 0 1-15 6.7L3 20M3 21v-5h5" />
        </svg>
      );
    case "spark":
      return (
        <svg {...baseProps}>
          <path d="M3 17l4-4 3 3 5-7 6 8" />
        </svg>
      );
    case "split":
      return (
        <svg {...baseProps}>
          <path d="M6 3v6a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v4M18 3v0M6 21v0" />
        </svg>
      );
    case "sun":
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      );
    case "moon":
      return (
        <svg {...baseProps}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      );
    case "trash":
      return (
        <svg {...baseProps}>
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case "external-link":
      return (
        <svg {...baseProps}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
        </svg>
      );
    case "edit":
      return (
        <svg {...baseProps}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    case "copy":
      return (
        <svg {...baseProps}>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "download":
      return (
        <svg {...baseProps}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
      );
    case "upload":
      return (
        <svg {...baseProps}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
      );
    default:
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}
