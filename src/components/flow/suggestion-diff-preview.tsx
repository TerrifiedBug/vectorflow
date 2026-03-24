"use client";

import type { DiffResult } from "@/lib/ai/suggestion-diff";

interface SuggestionDiffPreviewProps {
  diff: DiffResult;
}

export function SuggestionDiffPreview({ diff }: SuggestionDiffPreviewProps) {
  if (diff.type === "json") {
    return (
      <div className="mt-2 text-xs font-mono bg-muted rounded px-2 py-1 space-y-0.5">
        {diff.changes.map((change) => (
          <div key={change.key}>
            <span className="text-muted-foreground">{change.key}:</span>{" "}
            {change.before !== undefined ? (
              <span className="text-red-600 dark:text-red-400 line-through">
                {JSON.stringify(change.before)}
              </span>
            ) : null}
            {change.before !== undefined && change.after !== undefined ? " " : null}
            {change.after !== undefined ? (
              <span className="text-green-600 dark:text-green-400">
                {JSON.stringify(change.after)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  // type === "lines"
  return (
    <div className="mt-2 text-xs font-mono bg-muted rounded px-2 py-1.5 whitespace-pre-wrap">
      {diff.hunks.map((hunk, i) => {
        if (hunk.added) {
          return (
            <div key={i} className="text-green-600 dark:text-green-400">
              {prefixLines(hunk.value, "+")}
            </div>
          );
        }
        if (hunk.removed) {
          return (
            <div key={i} className="text-red-600 dark:text-red-400">
              {prefixLines(hunk.value, "-")}
            </div>
          );
        }
        return (
          <div key={i} className="text-muted-foreground">
            {prefixLines(hunk.value, " ")}
          </div>
        );
      })}
    </div>
  );
}

/** Prefix each line with a character (+/-/space) for diff display. */
function prefixLines(value: string, prefix: string): string {
  const lines = value.replace(/\n$/, "").split("\n");
  return lines.map((line) => `${prefix} ${line}`).join("\n");
}
