"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import { useTRPC } from "@/trpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, Code, ChevronLeft, ChevronRight, Columns3, Download, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { vrlTheme } from "./vrl-theme";
import { vrlLanguageDef } from "@/lib/vrl/vrl-language";
import { VRL_SNIPPETS } from "@/lib/vrl/snippets";
import { searchVrlFunctions, getVrlFunction } from "@/lib/vrl/function-registry";
import { VrlSnippetDrawer } from "@/components/flow/vrl-snippet-drawer";
import { VrlFieldsPanel } from "./vrl-fields-panel";
import { VrlAiPanel } from "./vrl-ai-panel";
import { useVrlAiConversation } from "@/hooks/use-vrl-ai-conversation";

import { useTeamStore } from "@/stores/team-store";
import { getMergedOutputSchemas, getSourceOutputSchema } from "@/lib/vector/source-output-schemas";
import type { Monaco, OnMount } from "@monaco-editor/react";

type EditorInstance = Parameters<OnMount>[0];

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-[200px] flex-col gap-2 rounded border bg-muted/30 p-4">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  ),
});

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface VrlEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  sourceTypes?: string[];
  pipelineId?: string;
  componentKey?: string;
  upstreamSourceKeys?: string[];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function VrlEditor({ value, onChange, sourceTypes, pipelineId, componentKey, upstreamSourceKeys }: VrlEditorProps) {
  const trpc = useTRPC();
  const [sampleInput, setSampleInput] = useState("");
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  type RightPanel = "fields" | "snippets" | "ai" | null;
  const [rightPanel, setRightPanel] = useState<RightPanel>("fields");
  const [expanded, setExpanded] = useState(false);
  const editorRef = useRef<EditorInstance | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const fieldProviderRef = useRef<{ dispose: () => void } | null>(null);
  const snippetProviderRef = useRef<{ dispose: () => void } | null>(null);
  const functionProviderRef = useRef<{ dispose: () => void } | null>(null);
  const hoverProviderRef = useRef<{ dispose: () => void } | null>(null);
  const signatureHelpProviderRef = useRef<{ dispose: () => void } | null>(null);

  const [sampleLimit, setSampleLimit] = useState(5);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [sampleEvents, setSampleEvents] = useState<unknown[]>([]);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [liveSchemaFields, setLiveSchemaFields] = useState<Array<{ path: string; type: string; sample: string }>>([]);

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const teamQuery = useQuery(
    trpc.team.get.queryOptions(
      { id: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );
  const aiEnabled = teamQuery.data?.aiEnabled ?? false;

  const canUseAiChat = aiEnabled && !!pipelineId && !!componentKey;

  const togglePanel = (panel: RightPanel) => {
    setRightPanel((prev) => (prev === panel ? null : panel));
  };

  const isRawTextSource = useMemo(() => {
    if (!sourceTypes || sourceTypes.length === 0) return false;
    return sourceTypes.some((t) => {
      const schema = getSourceOutputSchema(t);
      return schema?.rawText === true;
    });
  }, [sourceTypes]);

  const hasFields = (sourceTypes && sourceTypes.length > 0) || liveSchemaFields.length > 0;

  const staticFieldsForPanel = useMemo(
    () => getMergedOutputSchemas(sourceTypes ?? []),
    [sourceTypes],
  );

  const mergedFieldsForAi = useMemo(() => {
    const staticFields = getMergedOutputSchemas(sourceTypes ?? []);
    const liveByPath = new Map(liveSchemaFields.map((f) => [f.path, f]));
    const all = staticFields.map((f) => {
      liveByPath.delete(f.path);
      return { name: f.path.replace(/^\./, ""), type: f.type };
    });
    for (const [, f] of liveByPath) {
      all.push({ name: f.path.replace(/^\./, ""), type: f.type });
    }
    return all;
  }, [sourceTypes, liveSchemaFields]);

  const conversation = useVrlAiConversation({
    pipelineId: pipelineId ?? "",
    componentKey: componentKey ?? "",
    currentCode: value,
    fields: mergedFieldsForAi,
    sourceTypes,
  });

  const testMutation = useMutation(
    trpc.vrl.test.mutationOptions({
      onSuccess: (data) => {
        setTestOutput(data.output);
        setTestError(data.error ?? null);
      },
      onError: (err) => {
        setTestError(err.message);
        setTestOutput(null);
      },
    }),
  );

  const requestSamplesMutation = useMutation(
    trpc.pipeline.requestSamples.mutationOptions({
      onSuccess: (data) => setRequestId(data.requestId),
      onError: (err) => setTestError(`Sample request failed: ${err.message}`),
    }),
  );

  const sampleResultQuery = useQuery(
    trpc.pipeline.sampleResult.queryOptions(
      { requestId: requestId! },
      {
        enabled: !!requestId,
        refetchInterval: (query) => {
          const status = query.state.data?.status;
          return status === "PENDING" ? 3000 : false;
        },
      },
    ),
  );

  useEffect(() => {
    const data = sampleResultQuery.data;
    if (!data || data.status === "PENDING") return;

    if (data.status === "COMPLETED" && data.samples.length > 0) {
      const sample = data.samples[0];
      if (sample.error) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTestError(`Sampling error: ${sample.error}`);
      } else {
        const events = (sample.events as unknown[]) ?? [];
        setSampleEvents(events);
        setSampleIndex(0);
        if (events.length > 0) {
          setSampleInput(JSON.stringify(events[0], null, 2));
        }
        const schema = (sample.schema as Array<{ path: string; type: string; sample: string }>) ?? [];
        setLiveSchemaFields(schema);
        if (schema.length > 0) {
          setRightPanel("fields");
        }
      }
    } else if (data.status === "ERROR" || data.status === "EXPIRED") {
      setTestError(`Sampling ${data.status.toLowerCase()}: no events could be collected`);
    }

    setRequestId(null);
  }, [sampleResultQuery.data]);

  const handleFetchSamples = useCallback(() => {
    if (!pipelineId || !upstreamSourceKeys?.length) return;
    requestSamplesMutation.mutate({
      pipelineId,
      componentKeys: upstreamSourceKeys,
      limit: sampleLimit,
    });
  }, [pipelineId, upstreamSourceKeys, sampleLimit, requestSamplesMutation]);

  const isSampling = !!requestId || requestSamplesMutation.isPending;

  const handleEditorWillMount = useCallback((monaco: Monaco) => {
    // Register VRL language before editor mounts (prevents race condition)
    if (!monaco.languages.getLanguages().some((lang: { id: string }) => lang.id === "vrl")) {
      monaco.languages.register({ id: "vrl" });
      monaco.languages.setMonarchTokensProvider("vrl", vrlLanguageDef);
    }
    // Define theme here too (before mount ensures it's available)
    monaco.editor.defineTheme("vrl-theme", vrlTheme);
  }, []);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Theme already defined in beforeMount
    monaco.editor.setTheme("vrl-theme");
    editor.focus();
  }, []);

  // Register snippet completion provider once when Monaco is available.
  // useEffect cleanup disposes on unmount, preventing duplicates across Dialog open/close cycles.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    snippetProviderRef.current?.dispose();
    snippetProviderRef.current = monaco.languages.registerCompletionItemProvider("vrl", {
      provideCompletionItems(model: { getWordUntilPosition: (pos: unknown) => { startColumn: number; endColumn: number } }, position: { lineNumber: number }) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: VRL_SNIPPETS.map((s) => ({
            label: s.name,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: s.code,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: s.category,
            documentation: s.description,
            range,
          })),
        };
      },
    });

    return () => {
      snippetProviderRef.current?.dispose();
      snippetProviderRef.current = null;
    };
  }, [expanded]);

  // Register function completion provider
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    functionProviderRef.current?.dispose();
    functionProviderRef.current = monaco.languages.registerCompletionItemProvider("vrl", {
      provideCompletionItems(model: import("monaco-editor").editor.ITextModel, position: import("monaco-editor").Position) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        // Only show when there's at least 1 typed character
        if (word.word.length === 0) return { suggestions: [] };

        const matches = searchVrlFunctions(word.word);
        return {
          suggestions: matches.map((fn) => {
            // Build snippet insert text with parameter placeholders
            const paramSnippets = fn.params
              .filter((p) => p.required)
              .map((p, i) => `\${${i + 1}:${p.name}}`)
              .join(", ");
            const insertText = `${fn.name}(${paramSnippets})`;

            return {
              label: {
                label: fn.name,
                detail: `  (${fn.category})`,
                description: fn.fallible ? "fallible" : "",
              },
              kind: monaco.languages.CompletionItemKind.Function,
              insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: `${fn.category} — ${fn.fallible ? "fallible, use ! for error handling" : "infallible"}`,
              documentation: {
                value: `${fn.description}\n\n**Example:**\n\`\`\`vrl\n${fn.example}\n\`\`\``,
              },
              range,
              sortText: `0_${fn.name}`,
            };
          }),
        };
      },
    });

    return () => {
      functionProviderRef.current?.dispose();
      functionProviderRef.current = null;
    };
  }, [expanded]);

  // Register hover provider for function documentation
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    hoverProviderRef.current?.dispose();
    hoverProviderRef.current = monaco.languages.registerHoverProvider("vrl", {
      provideHover(model: import("monaco-editor").editor.ITextModel, position: import("monaco-editor").Position) {
        const line = model.getLineContent(position.lineNumber);
        const column = position.column - 1; // 0-indexed

        // Extract full identifier at cursor (handles underscores in function names)
        const before = line.substring(0, column);
        const after = line.substring(column);
        const beforeMatch = before.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
        const afterMatch = after.match(/^[a-zA-Z0-9_]*/);
        if (!beforeMatch && !afterMatch) return null;

        const word = (beforeMatch?.[0] ?? "") + (afterMatch?.[0] ?? "");
        if (!word || !/^[a-zA-Z_]/.test(word)) return null;
        const startColumn = column - (beforeMatch?.[0].length ?? 0) + 1;
        const endColumn = startColumn + word.length;

        const fn = getVrlFunction(word);
        if (!fn) return null;

        // Build signature string
        const params = fn.params
          .map((p) => {
            const opt = p.required ? "" : "?";
            const def = p.default ? ` = ${p.default}` : "";
            return `${p.name}${opt}: ${p.type}${def}`;
          })
          .join(", ");
        const fallibleBadge = fn.fallible ? " `[fallible]`" : "";

        const markdown = [
          `**${fn.name}**(${params}) → ${fn.returnType}${fallibleBadge}`,
          "",
          fn.description,
          "",
          "```vrl",
          fn.example,
          "```",
        ].join("\n");

        return {
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn,
            endColumn,
          },
          contents: [{ value: markdown }],
        };
      },
    });

    return () => {
      hoverProviderRef.current?.dispose();
      hoverProviderRef.current = null;
    };
  }, [expanded]);

  // Register signature help provider for parameter hints
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    signatureHelpProviderRef.current?.dispose();
    signatureHelpProviderRef.current = monaco.languages.registerSignatureHelpProvider("vrl", {
      signatureHelpTriggerCharacters: ["(", ","],
      provideSignatureHelp(model: import("monaco-editor").editor.ITextModel, position: import("monaco-editor").Position) {
        const line = model.getLineContent(position.lineNumber);
        const textBefore = line.substring(0, position.column - 1);

        // Find the innermost unclosed '(' by tracking parenthesis depth
        let depth = 0;
        let funcEnd = -1;
        for (let i = textBefore.length - 1; i >= 0; i--) {
          if (textBefore[i] === ")") depth++;
          else if (textBefore[i] === "(") {
            if (depth === 0) {
              funcEnd = i;
              break;
            }
            depth--;
          }
        }
        if (funcEnd < 0) return null;

        // Extract function name before the '('
        const beforeParen = textBefore.substring(0, funcEnd);
        const nameMatch = beforeParen.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
        if (!nameMatch) return null;

        const fn = getVrlFunction(nameMatch[1]);
        if (!fn || fn.params.length === 0) return null;

        // Count commas to determine active parameter
        const argsText = textBefore.substring(funcEnd + 1);
        let commaCount = 0;
        let parenDepth = 0;
        for (const ch of argsText) {
          if (ch === "(") parenDepth++;
          else if (ch === ")") parenDepth--;
          else if (ch === "," && parenDepth === 0) commaCount++;
        }

        // Build signature
        const paramLabels = fn.params.map((p) => {
          const opt = p.required ? "" : "?";
          const def = p.default ? ` = ${p.default}` : "";
          return `${p.name}${opt}: ${p.type}${def}`;
        });
        const label = `${fn.name}(${paramLabels.join(", ")}) → ${fn.returnType}`;

        return {
          value: {
            signatures: [
              {
                label,
                documentation: fn.description,
                parameters: fn.params.map((p) => ({
                  label: `${p.name}${p.required ? "" : "?"}: ${p.type}${p.default ? ` = ${p.default}` : ""}`,
                  documentation: `${p.description}${p.required ? " (required)" : " (optional)"}`,
                })),
              },
            ],
            activeSignature: 0,
            activeParameter: Math.min(commaCount, fn.params.length - 1),
          },
          dispose() {},
        };
      },
    });

    return () => {
      signatureHelpProviderRef.current?.dispose();
      signatureHelpProviderRef.current = null;
    };
  }, [expanded]);

  // Re-register field completion provider when sourceTypes or liveSchemaFields change
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    // Dispose previous field provider
    fieldProviderRef.current?.dispose();
    fieldProviderRef.current = null;

    const hasStaticFields = sourceTypes && sourceTypes.length > 0;
    const hasLiveFields = liveSchemaFields.length > 0;
    if (!hasStaticFields && !hasLiveFields) return;

    // Merge static + live fields
    const staticFields = getMergedOutputSchemas(sourceTypes ?? []);
    const liveByPath = new Map(liveSchemaFields.map((f) => [f.path, f]));
    const allFields = staticFields.map((f) => {
      const live = liveByPath.get(f.path);
      if (live) {
        liveByPath.delete(f.path);
        return { ...f, description: `${f.description} | Sample: ${live.sample}` };
      }
      return f;
    });
    for (const [, f] of liveByPath) {
      allFields.push({ path: f.path, type: f.type, description: `Sample: ${f.sample}`, always: false });
    }

    fieldProviderRef.current = monaco.languages.registerCompletionItemProvider("vrl", {
      triggerCharacters: ["."],
      provideCompletionItems(
        model: { getLineContent: (line: number) => string; getWordUntilPosition: (pos: { lineNumber: number; column: number }) => { startColumn: number; endColumn: number } },
        position: { lineNumber: number; column: number },
      ) {
        const lineContent = model.getLineContent(position.lineNumber);
        const textBeforeCursor = lineContent.substring(0, position.column - 1);
        const prefixMatch = textBeforeCursor.match(/(\.[\w.]*?)$/);
        const prefix = prefixMatch ? prefixMatch[1] : "";

        const suggestions = allFields
          .filter((f) => {
            if (!prefix) return f.path.split(".").length === 2;
            return f.path.startsWith(prefix + ".") && f.path.substring(prefix.length + 1).indexOf(".") === -1;
          })
          .map((f) => {
            const childName = prefix
              ? f.path.substring(prefix.length + 1)
              : f.path.substring(1);
            const isObject = f.type === "object" || f.type === "array";
            const word = model.getWordUntilPosition(position);
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            };
            return {
              label: childName,
              kind: isObject
                ? monaco.languages.CompletionItemKind.Module
                : monaco.languages.CompletionItemKind.Field,
              insertText: childName,
              detail: f.type,
              documentation: f.description,
              sortText: (f.always ? "0" : "1") + childName,
              range,
            };
          });

        return { suggestions };
      },
    });

    return () => {
      fieldProviderRef.current?.dispose();
      fieldProviderRef.current = null;
    };
  }, [sourceTypes, liveSchemaFields]);

  const handleInsertSnippet = useCallback((code: string) => {
    const editor = editorRef.current;
    if (!editor) {
      onChange(value ? value + "\n" + code : code);
      return;
    }
    const selection = editor.getSelection();
    if (selection) {
      editor.executeEdits("snippet", [
        { range: { startLineNumber: selection.endLineNumber, startColumn: selection.endColumn, endLineNumber: selection.endLineNumber, endColumn: selection.endColumn }, text: "\n" + code },
      ]);
    }
  }, [value, onChange]);

  const handleTest = useCallback(() => {
    setTestOutput(null);
    setTestError(null);
    testMutation.mutate({ source: value, input: sampleInput });
  }, [value, sampleInput, testMutation]);

  return (
    <div className="space-y-2">
      {/* Inline: just a button + VRL preview */}
      <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
        <Code className="mr-1.5 h-3.5 w-3.5" />
        Open VRL Editor
      </Button>

      {/* Full-screen modal: editor (left) + tools (right) */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="h-[85vh] flex flex-col sm:max-w-[calc(100vw-4rem)] xl:max-w-6xl"
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>VRL Editor</DialogTitle>
          </DialogHeader>

          {/* Toolbar — always visible */}
          <div className="flex flex-wrap gap-2 shrink-0">
            {hasFields && (
              <Button
                variant={rightPanel === "fields" ? "secondary" : "outline"}
                size="sm"
                onClick={() => togglePanel("fields")}
              >
                <Columns3 className="mr-1.5 h-3.5 w-3.5" />
                Fields
              </Button>
            )}
            <Button
              variant={rightPanel === "snippets" ? "secondary" : "outline"}
              size="sm"
              onClick={() => togglePanel("snippets")}
            >
              <BookOpen className="mr-1.5 h-3.5 w-3.5" />
              Snippets
            </Button>
            {canUseAiChat && (
              <Button
                variant={rightPanel === "ai" ? "secondary" : "outline"}
                size="sm"
                onClick={() => togglePanel("ai")}
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                AI
              </Button>
            )}
            {pipelineId && upstreamSourceKeys && upstreamSourceKeys.length > 0 && (
              <>
                <Select value={String(sampleLimit)} onValueChange={(val) => setSampleLimit(Number(val))}>
                  <SelectTrigger className="h-8 w-[120px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 events</SelectItem>
                    <SelectItem value="10">10 events</SelectItem>
                    <SelectItem value="25">25 events</SelectItem>
                    <SelectItem value="50">50 events</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={handleFetchSamples} disabled={isSampling}>
                  {isSampling ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {isSampling ? "Sampling..." : "Fetch Samples"}
                </Button>
                {sampleEvents.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {sampleEvents.length} sample{sampleEvents.length !== 1 ? "s" : ""}
                  </Badge>
                )}
              </>
            )}
          </div>

          <div className="flex flex-1 gap-4 min-h-0">
            {/* Left: Monaco editor at full height */}
            <div className="flex-1 overflow-hidden rounded border">
              <Editor
                height="100%"
                language="vrl"
                value={value}
                onChange={(v) => onChange(v ?? "")}
                beforeMount={handleEditorWillMount}
                onMount={handleEditorMount}
                theme="vrl-theme"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  tabSize: 2,
                  automaticLayout: true,
                }}
              />
            </div>

            {/* Right panel: single slot for tools OR AI */}
            {rightPanel && (
              <div className="w-[380px] shrink-0 flex flex-col gap-3 min-h-0 overflow-hidden">
                {/* Tools content (fields, snippets, test panel) */}
                {(rightPanel === "fields" || rightPanel === "snippets") && (
                  <div className="flex flex-col gap-3 overflow-y-auto flex-1">
                    {/* Raw text source hint */}
                    {isRawTextSource && rightPanel !== "snippets" && (
                      <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
                        <p className="font-medium">This source emits raw text in <code className="rounded bg-sky-100 px-1 dark:bg-sky-900/50">.message</code></p>
                        <p className="mt-0.5 text-sky-700 dark:text-sky-400">
                          Use a parsing function to extract fields — click Snippets → Parsing for examples.
                        </p>
                      </div>
                    )}

                    {rightPanel === "fields" && (
                      <VrlFieldsPanel
                        staticFields={staticFieldsForPanel}
                        liveFields={liveSchemaFields}
                        onInsert={handleInsertSnippet}
                      />
                    )}

                    {rightPanel === "snippets" && (
                      <VrlSnippetDrawer onInsert={handleInsertSnippet} />
                    )}

                    {/* Test panel */}
                    <div className="space-y-3 rounded border p-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="vrl-sample-input" className="text-xs">
                            Sample Input (JSON)
                          </Label>
                          {sampleEvents.length > 1 && (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={sampleIndex <= 0}
                                aria-label="Previous sample"
                                onClick={() => {
                                  const newIdx = sampleIndex - 1;
                                  setSampleIndex(newIdx);
                                  setSampleInput(JSON.stringify(sampleEvents[newIdx], null, 2));
                                }}
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </Button>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {sampleIndex + 1}/{sampleEvents.length}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={sampleIndex >= sampleEvents.length - 1}
                                aria-label="Next sample"
                                onClick={() => {
                                  const newIdx = sampleIndex + 1;
                                  setSampleIndex(newIdx);
                                  setSampleInput(JSON.stringify(sampleEvents[newIdx], null, 2));
                                }}
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                        <textarea
                          id="vrl-sample-input"
                          className="w-full rounded border bg-muted/30 p-2 font-mono text-xs"
                          rows={4}
                          value={sampleInput}
                          onChange={(e) => setSampleInput(e.target.value)}
                          placeholder={'No test input — a default event will be used:\n{"message": "test event", "timestamp": "...", "host": "localhost"}'}
                        />
                      </div>

                      <Button
                        size="sm"
                        onClick={handleTest}
                        disabled={testMutation.isPending}
                      >
                        {testMutation.isPending ? "Running..." : "Run VRL"}
                      </Button>

                      {testOutput && (
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Output</Label>
                          <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2 font-mono text-xs">
                            {testOutput}
                          </pre>
                        </div>
                      )}

                      {testError && (
                        <div className="space-y-1">
                          <Label className="text-xs text-red-500">Error</Label>
                          <pre className="max-h-40 overflow-auto rounded border border-red-300 bg-red-50 p-2 font-mono text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
                            {testError}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* AI chat panel */}
                {rightPanel === "ai" && canUseAiChat && (
                  <VrlAiPanel
                    conversation={conversation}
                    currentCode={value}
                    onCodeChange={onChange}
                    onClose={() => setRightPanel(null)}
                  />
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
