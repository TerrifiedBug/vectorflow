"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { vrlTheme } from "./vrl-theme";
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
  const [sampleInput, setSampleInput] = useState('{"message": "hello world"}');
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [showTest, setShowTest] = useState(false);

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
    monaco.editor.defineTheme("vrl-theme", vrlTheme);
    monaco.editor.setTheme("vrl-theme");
  }, []);

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

      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowTest((prev) => !prev)}
      >
        {showTest ? "Hide Test" : "Test"}
      </Button>

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
              placeholder='{"message": "hello world"}'
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
    </div>
  );
}
