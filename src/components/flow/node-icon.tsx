import {
  FileText,
  Radio,
  Globe,
  Server,
  Play,
  Cpu,
  Code,
  Filter,
  GitBranch,
  Percent,
  Copy,
  BarChart,
  Database,
  Cloud,
  Terminal,
  Send,
  Link as LinkIcon,
  Gauge,
  Box,
  Activity,
  Container,
  MessageSquare,
  Zap,
  Shield,
  Layers,
  Timer,
  Shuffle,
  ArrowDownToLine,
  Webhook,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  FileText,
  Radio,
  Globe,
  Server,
  Play,
  Cpu,
  Code,
  Filter,
  GitBranch,
  Percent,
  Copy,
  BarChart,
  Database,
  Cloud,
  Terminal,
  Send,
  LinkIcon,
  Gauge,
  Activity,
  Container,
  MessageSquare,
  Zap,
  Shield,
  Layers,
  Timer,
  Shuffle,
  ArrowDownToLine,
  Webhook,
};

/**
 * Resolve a lucide icon name from the catalog to an actual component.
 * Falls back to the generic Box icon if not found.
 */
export function getIcon(iconName?: string): LucideIcon {
  if (!iconName) return Box;
  return iconMap[iconName] ?? Box;
}
