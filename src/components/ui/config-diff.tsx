"use client";

import { createTwoFilesPatch } from "diff";

interface ConfigDiffProps {
  oldConfig: string;
  newConfig: string;
  oldLabel?: string;
  newLabel?: string;
  className?: string;
}

export function ConfigDiff({
  oldConfig,
  newConfig,
  oldLabel = "deployed",
  newLabel = "pending",
  className,
}: ConfigDiffProps) {
  const patch = createTwoFilesPatch(oldLabel, newLabel, oldConfig, newConfig, "", "", { context: 3 });
  const lines = patch.split("\n");
  const headerEnd = lines.findIndex((l, i) => i > 0 && l.startsWith("@@"));
  const displayLines = headerEnd > 0 ? lines.slice(headerEnd) : lines.slice(2);

  if (displayLines.length === 0 || (displayLines.length === 1 && displayLines[0] === "")) {
    return (
      <p className="text-xs text-muted-foreground italic py-2">No changes detected.</p>
    );
  }

  return (
    <pre className={className ?? "p-4 text-xs font-mono leading-5 max-h-64 overflow-auto rounded-md bg-muted"}>
      {displayLines.map((line, i) => {
        let cn = "";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          cn = "bg-green-500/15 text-green-700 dark:text-green-400";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          cn = "bg-red-500/15 text-red-700 dark:text-red-400";
        } else if (line.startsWith("@@")) {
          cn = "text-blue-600 dark:text-blue-400 font-semibold";
        } else {
          cn = "text-muted-foreground";
        }
        return (<div key={i} className={cn}>{line || "\n"}</div>);
      })}
    </pre>
  );
}
