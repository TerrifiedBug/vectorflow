"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Loader2, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import type { ParsedBlock, TranslatedBlock } from "@/server/services/migration/types";
import yaml from "js-yaml";

interface BlockDetailPanelProps {
  block: ParsedBlock;
  translation: TranslatedBlock | null;
  onRetranslate: () => void;
  isRetranslating: boolean;
}

export function BlockDetailPanel({
  block,
  translation,
  onRetranslate,
  isRetranslating,
}: BlockDetailPanelProps) {
  return (
    <div className="p-4 space-y-4">
      {/* Block header */}
      <div>
        <h3 className="text-sm font-semibold">{block.pluginType}</h3>
        <p className="text-xs text-muted-foreground">
          {block.blockType}
          {block.tagPattern && ` — ${block.tagPattern}`}
        </p>
      </div>

      <Separator />

      {/* Original FluentD config */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-2">
          Original FluentD Config
        </h4>
        <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap">
          {block.rawText}
        </pre>
      </div>

      {/* Ruby expressions warning */}
      {block.rubyExpressions.length > 0 && (
        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
          <div className="flex items-center gap-1 text-xs font-medium text-yellow-800 dark:text-yellow-200 mb-1">
            <AlertTriangle className="h-3 w-3" />
            Ruby Expressions ({block.rubyExpressions.length})
          </div>
          <div className="text-xs text-yellow-700 dark:text-yellow-300 font-mono">
            {block.rubyExpressions.map((expr, i) => (
              <div key={i}>{expr}</div>
            ))}
          </div>
        </div>
      )}

      <Separator />

      {/* Translated Vector config */}
      {translation ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-muted-foreground">
              Translated Vector Config
            </h4>
            <div className="flex items-center gap-2">
              <ConfidenceBadge confidence={translation.confidence} />
              <Button
                size="sm"
                variant="ghost"
                onClick={onRetranslate}
                disabled={isRetranslating}
              >
                {isRetranslating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline">{translation.componentType}</Badge>
              <Badge variant="outline">{translation.kind}</Badge>
              <span className="text-muted-foreground">
                {translation.componentId}
              </span>
            </div>
          </div>

          <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap">
            {yaml.dump(translation.config, { indent: 2, lineWidth: -1 })}
          </pre>

          {/* Inputs */}
          {translation.inputs.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">Inputs: </span>
              {translation.inputs.join(", ")}
            </div>
          )}

          {/* Validation errors */}
          {translation.validationErrors.length > 0 && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <div className="flex items-center gap-1 text-xs font-medium text-red-800 dark:text-red-200 mb-1">
                <XCircle className="h-3 w-3" />
                Validation Errors
              </div>
              {translation.validationErrors.map((err, i) => (
                <div
                  key={i}
                  className="text-xs text-red-700 dark:text-red-300"
                >
                  {err}
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          {translation.notes.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-muted-foreground mb-1">
                Migration Notes
              </h5>
              <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                {translation.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          Not yet translated. Click &quot;Translate with AI&quot; to begin.
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 80) {
    return (
      <Badge variant="default" className="gap-1 bg-green-600 text-xs">
        <CheckCircle className="h-3 w-3" />
        {confidence}%
      </Badge>
    );
  }
  if (confidence >= 50) {
    return (
      <Badge variant="default" className="gap-1 bg-yellow-600 text-xs">
        <AlertTriangle className="h-3 w-3" />
        {confidence}%
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1 text-xs">
      <XCircle className="h-3 w-3" />
      {confidence}%
    </Badge>
  );
}
