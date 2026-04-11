"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Loader2, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import type { ParsedBlock, TranslatedBlock } from "@/server/services/migration/types";
import "@/lib/monaco-config";
import Editor from "@monaco-editor/react";
import yaml from "js-yaml";
import { toast } from "sonner";

interface BlockDetailPanelProps {
  block: ParsedBlock;
  translation: TranslatedBlock | null;
  onRetranslate: () => void;
  onSaveConfig: (config: Record<string, unknown>) => void;
  isRetranslating: boolean;
  isSaving?: boolean;
}

export function BlockDetailPanel({
  block,
  translation,
  onRetranslate,
  onSaveConfig,
  isRetranslating,
  isSaving,
}: BlockDetailPanelProps) {
  const [editorValue, setEditorValue] = useState<string>(() =>
    translation ? yaml.dump(translation.config, { indent: 2, lineWidth: -1 }) : ""
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Editor state resets via key prop on the parent (keyed by block ID + confidence),
  // so no useEffect needed to sync translation → editor value.

  const handleSave = () => {
    try {
      const parsed = yaml.load(editorValue) as Record<string, unknown>;
      onSaveConfig(parsed);
      setHasUnsavedChanges(false);
    } catch {
      toast.error("Invalid YAML syntax");
    }
  };

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

      <Separator />

      {/* Translated Vector config */}
      {translation ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-muted-foreground">
              Translated Vector Config
            </h4>
            <ConfidenceBadge confidence={translation.confidence} />
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

          <Editor
            height="200px"
            language="yaml"
            theme="vs-dark"
            value={editorValue}
            onChange={(value) => {
              if (value !== undefined) {
                setEditorValue(value);
                setHasUnsavedChanges(true);
              }
            }}
            options={{
              minimap: { enabled: false },
              lineNumbers: "on",
              fontSize: 12,
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
              automaticLayout: true,
            }}
          />

          {/* Save and Re-translate buttons */}
          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={!hasUnsavedChanges || isSaving}
              className="relative"
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save
              {hasUnsavedChanges && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRetranslate}
              disabled={isRetranslating}
            >
              {isRetranslating ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              Re-translate
            </Button>
          </div>

          {/* Inputs */}
          {translation.inputs.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">Inputs: </span>
              {translation.inputs.join(", ")}
            </div>
          )}

          {/* Inline help section */}

          {/* Translation notes */}
          {translation.notes.length > 0 && (
            <div className="p-2 rounded bg-muted text-xs">
              <p className="font-medium mb-1">Translation Notes</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {translation.notes.map((note, i) => (
                  <li key={i}>{"\u2022"} {note}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Low confidence warning */}
          {translation.confidence < 50 && (
            <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3 inline mr-1" />
              This translation may need manual review (confidence: {translation.confidence}%)
            </div>
          )}

          {/* Ruby expression note */}
          {block.rubyExpressions.length > 0 && (
            <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3 inline mr-1" />
              Contains {block.rubyExpressions.length} Ruby expression(s) — VRL mapping is best-effort
            </div>
          )}

          {/* Validation errors */}
          {translation.validationErrors.length > 0 && (
            <div className="p-2 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive">
              <XCircle className="h-3 w-3 inline mr-1" />
              Validation errors:
              <ul className="mt-1 space-y-0.5 font-mono">
                {translation.validationErrors.map((err, i) => (
                  <li key={i}>{err}</li>
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
