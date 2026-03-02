"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import { useTRPC } from "@/trpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, Maximize2, ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { vrlTheme } from "./vrl-theme";
import { VRL_SNIPPETS } from "@/lib/vrl/snippets";
import { VrlSnippetDrawer } from "@/components/flow/vrl-snippet-drawer";
import { getMergedOutputSchemas, getSourceOutputSchema } from "@/lib/vector/source-output-schemas";
import type { Monaco, OnMount } from "@monaco-editor/react";

type EditorInstance = Parameters<OnMount>[0];

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-[200px] items-center justify-center rounded border bg-muted/30">
      <p className="text-sm text-muted-foreground">Loading editor...</p>
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
  upstreamSourceKeys?: string[];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function VrlEditor({ value, onChange, height = "200px", sourceTypes, pipelineId, upstreamSourceKeys }: VrlEditorProps) {
  const trpc = useTRPC();
  const [sampleInput, setSampleInput] = useState("");
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [showTest, setShowTest] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const editorRef = useRef<EditorInstance | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const fieldProviderRef = useRef<{ dispose: () => void } | null>(null);

  const [requestId, setRequestId] = useState<string | null>(null);
  const [sampleEvents, setSampleEvents] = useState<unknown[]>([]);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [liveSchemaFields, setLiveSchemaFields] = useState<Array<{ path: string; type: string; sample: string }>>([]);

  const isRawTextSource = useMemo(() => {
    if (!sourceTypes || sourceTypes.length === 0) return false;
    return sourceTypes.some((t) => {
      const schema = getSourceOutputSchema(t);
      return schema?.rawText === true;
    });
  }, [sourceTypes]);

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
        setTestError(`Sampling error: ${sample.error}`);
      } else {
        const events = (sample.events as unknown[]) ?? [];
        setSampleEvents(events);
        setSampleIndex(0);
        if (events.length > 0) {
          setSampleInput(JSON.stringify(events[0], null, 2));
          setShowTest(true);
        }
        const schema = (sample.schema as Array<{ path: string; type: string; sample: string }>) ?? [];
        setLiveSchemaFields(schema);
      }
    } else if (data.status === "ERROR" || data.status === "EXPIRED") {
      setTestError(`Sampling ${data.status.toLowerCase()}: no events could be collected`);
      setShowTest(true);
    }

    setRequestId(null);
  }, [sampleResultQuery.data]);

  const handleFetchSamples = useCallback(() => {
    if (!pipelineId || !upstreamSourceKeys?.length) return;
    requestSamplesMutation.mutate({
      pipelineId,
      componentKeys: upstreamSourceKeys,
    });
  }, [pipelineId, upstreamSourceKeys, requestSamplesMutation]);

  const isSampling = !!requestId || requestSamplesMutation.isPending;

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.defineTheme("vrl-theme", vrlTheme);
    monaco.editor.setTheme("vrl-theme");

    // Register VRL snippet completions (static, only needs to happen once)
    monaco.languages.registerCompletionItemProvider("plaintext", {
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
  }, []);

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

    fieldProviderRef.current = monaco.languages.registerCompletionItemProvider("plaintext", {
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
    <div className="space-y-3">
      <div className="overflow-hidden rounded border">
          <Editor
            height={height}
            language="plaintext"
            value={value}
            onChange={(v) => onChange(v ?? "")}
            onMount={handleEditorMount}
            theme="vrl-theme"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
              automaticLayout: true,
            }}
          />
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSnippets((prev) => !prev)}
        >
          <BookOpen className="mr-1.5 h-3.5 w-3.5" />
          {showSnippets ? "Hide Snippets" : "Snippets"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowTest((prev) => !prev)}
        >
          {showTest ? "Hide Test" : "Test"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 className="mr-1.5 h-3.5 w-3.5" />
          Expand
        </Button>
        {pipelineId && upstreamSourceKeys && upstreamSourceKeys.length > 0 && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleFetchSamples}
              disabled={isSampling}
            >
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

      {isRawTextSource && !showSnippets && (
        <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
          <p className="font-medium">This source emits raw text in <code className="rounded bg-sky-100 px-1 dark:bg-sky-900/50">.message</code></p>
          <p className="mt-0.5 text-sky-700 dark:text-sky-400">
            Use a parsing function to extract fields — click Snippets → Parsing for examples.
          </p>
        </div>
      )}

      {showSnippets && (
        <VrlSnippetDrawer onInsert={handleInsertSnippet} />
      )}

      {showTest && (
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
      )}

      {/* Expanded full-screen editor */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>VRL Editor</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden rounded border">
            <Editor
              height="100%"
              language="plaintext"
              value={value}
              onChange={(v) => onChange(v ?? "")}
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
