"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DiffViewerProps {
  oldYaml: string | null;
  newYaml: string;
}

/**
 * Computes a simple line-level diff between two texts.
 * Returns arrays of lines with their diff status.
 */
function computeLineDiff(
  oldText: string,
  newText: string,
): Array<{ line: string; type: "added" | "removed" | "unchanged" }> {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: Array<{
    line: string;
    type: "added" | "removed" | "unchanged";
  }> = [];

  // Simple line-by-line comparison. For a production app we would use
  // a proper diff algorithm, but this is sufficient for YAML configs.
  let oi = 0;
  let ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      result.push({ line: newLines[ni], type: "added" });
      ni++;
    } else if (ni >= newLines.length) {
      result.push({ line: oldLines[oi], type: "removed" });
      oi++;
    } else if (oldLines[oi] === newLines[ni]) {
      result.push({ line: oldLines[oi], type: "unchanged" });
      oi++;
      ni++;
    } else {
      // Look ahead to see if old line appears later in new
      const newIdx = newLines.indexOf(oldLines[oi], ni);
      const oldIdx = oldLines.indexOf(newLines[ni], oi);

      if (newIdx !== -1 && (oldIdx === -1 || newIdx - ni <= oldIdx - oi)) {
        // Lines were added before the old line
        while (ni < newIdx) {
          result.push({ line: newLines[ni], type: "added" });
          ni++;
        }
      } else if (oldIdx !== -1) {
        // Lines were removed before the new line
        while (oi < oldIdx) {
          result.push({ line: oldLines[oi], type: "removed" });
          oi++;
        }
      } else {
        result.push({ line: oldLines[oi], type: "removed" });
        result.push({ line: newLines[ni], type: "added" });
        oi++;
        ni++;
      }
    }
  }

  return result;
}

export function DiffViewer({ oldYaml, newYaml }: DiffViewerProps) {
  const isNewDeployment = !oldYaml;

  return (
    <Tabs defaultValue={isNewDeployment ? "new" : "diff"} className="w-full">
      <TabsList>
        {!isNewDeployment && (
          <TabsTrigger value="diff">Unified Diff</TabsTrigger>
        )}
        {!isNewDeployment && (
          <TabsTrigger value="side-by-side">Side by Side</TabsTrigger>
        )}
        <TabsTrigger value="new">New Config</TabsTrigger>
        {!isNewDeployment && (
          <TabsTrigger value="current">Current Config</TabsTrigger>
        )}
      </TabsList>

      {!isNewDeployment && oldYaml && (
        <TabsContent value="diff">
          <ScrollArea className="h-[400px] rounded-md border">
            <pre className="p-4 text-sm font-mono">
              {computeLineDiff(oldYaml, newYaml).map((entry, i) => (
                <div
                  key={i}
                  className={
                    entry.type === "added"
                      ? "bg-green-500/10 text-green-700 dark:text-green-400"
                      : entry.type === "removed"
                        ? "bg-red-500/10 text-red-700 dark:text-red-400"
                        : "text-muted-foreground"
                  }
                >
                  <span className="inline-block w-6 select-none text-right opacity-50">
                    {entry.type === "added"
                      ? "+"
                      : entry.type === "removed"
                        ? "-"
                        : " "}
                  </span>
                  {" "}
                  {entry.line}
                </div>
              ))}
            </pre>
          </ScrollArea>
        </TabsContent>
      )}

      {!isNewDeployment && oldYaml && (
        <TabsContent value="side-by-side">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Current
              </p>
              <ScrollArea className="h-[400px] rounded-md border">
                <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
                  {oldYaml}
                </pre>
              </ScrollArea>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                New
              </p>
              <ScrollArea className="h-[400px] rounded-md border">
                <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
                  {newYaml}
                </pre>
              </ScrollArea>
            </div>
          </div>
        </TabsContent>
      )}

      <TabsContent value="new">
        <ScrollArea className="h-[400px] rounded-md border">
          <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
            {newYaml}
          </pre>
        </ScrollArea>
      </TabsContent>

      {!isNewDeployment && oldYaml && (
        <TabsContent value="current">
          <ScrollArea className="h-[400px] rounded-md border">
            <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
              {oldYaml}
            </pre>
          </ScrollArea>
        </TabsContent>
      )}
    </Tabs>
  );
}
