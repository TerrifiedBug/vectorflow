"use client";

import { ALERT_RULE_TEMPLATES, type AlertRuleTemplate } from "@/lib/alert-templates";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { METRIC_LABELS } from "./constants";

interface TemplatePick {
  name: string;
  metric: string;
  condition: string;
  threshold: string;
  durationSeconds: string;
  severity: "info" | "warning" | "critical";
  ownerHint: string;
  suggestedAction: string;
  keyword?: string;
  keywordWindowMinutes?: string;
}

interface AlertTemplatePickerProps {
  onSelect: (values: TemplatePick) => void;
}

export function AlertTemplatePicker({ onSelect }: AlertTemplatePickerProps) {
  const handleSelect = (template: AlertRuleTemplate) => {
    onSelect({
      name: template.name,
      metric: template.defaults.metric,
      condition: template.defaults.condition,
      threshold: template.defaults.threshold,
      durationSeconds: template.defaults.durationSeconds,
      severity: template.defaults.severity,
      ownerHint: template.defaults.ownerHint,
      suggestedAction: template.defaults.suggestedAction,
      ...(template.defaults.metric === "log_keyword"
        ? { keyword: "", keywordWindowMinutes: "5" }
        : {}),
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Start from a template</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ALERT_RULE_TEMPLATES.map((template) => {
          const Icon = template.icon;
          return (
            <Card
              key={template.id}
              role="button"
              tabIndex={0}
              className="cursor-pointer py-3 transition-colors hover:border-primary/50 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => handleSelect(template)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelect(template);
                }
              }}
            >
              <CardHeader className="gap-1.5 px-3">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <CardTitle className="text-sm leading-tight">
                    {template.name}
                  </CardTitle>
                </div>
                <CardDescription className="text-xs leading-snug">
                  {template.description}
                </CardDescription>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge variant="secondary" className="w-fit text-[10px]">
                    {METRIC_LABELS[template.defaults.metric] ?? template.defaults.metric}
                  </Badge>
                  <Badge variant="outline" className="w-fit text-[10px] capitalize">
                    {template.defaults.severity}
                  </Badge>
                  <Badge variant="outline" className="w-fit text-[10px]">
                    {template.defaults.ownerHint}
                  </Badge>
                </div>
              </CardHeader>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
