"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { Monaco } from "@monaco-editor/react";

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
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function VrlEditor({ value, onChange, height = "200px" }: VrlEditorProps) {
  const trpc = useTRPC();
  const [sampleInput, setSampleInput] = useState("");
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [showTest, setShowTest] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const editorRef = useRef<any>(null);

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

  const handleEditorMount = useCallback((_editor: unknown, monaco: Monaco) => {
    editorRef.current = _editor;
    monaco.editor.defineTheme("vrl-theme", vrlTheme);
    monaco.editor.setTheme("vrl-theme");

    // Register VRL snippet completions
    monaco.languages.registerCompletionItemProvider("plaintext", {
      provideCompletionItems(model: any, position: any) {
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
      </div>

      {showSnippets && (
        <VrlSnippetDrawer onInsert={handleInsertSnippet} />
      )}

      {showTest && (
        <div className="space-y-3 rounded border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="vrl-sample-input" className="text-xs">
              Sample Input (JSON)
            </Label>
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
