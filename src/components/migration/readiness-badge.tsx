import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";

interface ReadinessBadgeProps {
  score: number | null;
}

export function ReadinessBadge({ score }: ReadinessBadgeProps) {
  if (score === null || score === undefined) return null;

  if (score >= 70) {
    return (
      <Badge variant="default" className="gap-1 bg-green-600">
        <CheckCircle className="h-3 w-3" />
        {score}% Ready
      </Badge>
    );
  }

  if (score >= 40) {
    return (
      <Badge variant="default" className="gap-1 bg-yellow-600">
        <AlertTriangle className="h-3 w-3" />
        {score}% Ready
      </Badge>
    );
  }

  return (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" />
      {score}% Ready
    </Badge>
  );
}
