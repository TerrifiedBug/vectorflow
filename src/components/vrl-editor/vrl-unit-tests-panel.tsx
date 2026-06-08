"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Loader2, Play, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface VrlUnitTestsPanelProps {
  pipelineId: string;
  componentKey: string;
  /** The editor's current VRL source — what the runner evaluates against. */
  source: string;
  /** Optional seed for a new test's input (e.g. the current sample event). */
  initialInput?: string;
}

/** Mirrors `VrlUnitTestRunResult` from the vrl router. */
interface RunResult {
  id: string;
  name: string;
  passed: boolean;
  actual: unknown;
  expected: unknown;
}

/**
 * IF-6 — the "Unit tests" section of the VRL editor. Defines input→expected
 * snippets for a transform component, runs them against the editor's current
 * source via `vrl.runUnitTests`, and shows pass/fail (with expected-vs-actual
 * for failures). Storage + runner live in the tRPC router; this is the visual
 * surface. Only rendered when a pipeline + component are in scope.
 */
export function VrlUnitTestsPanel({
  pipelineId,
  componentKey,
  source,
  initialInput,
}: VrlUnitTestsPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [inputText, setInputText] = useState("");
  const [expectedText, setExpectedText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);

  const listQuery = useQuery(
    trpc.vrl.listUnitTests.queryOptions({ pipelineId, componentKey }),
  );
  const listKey = trpc.vrl.listUnitTests.queryKey({ pipelineId, componentKey });

  const createMutation = useMutation(
    trpc.vrl.createUnitTest.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: listKey });
        setShowForm(false);
        setName("");
        setInputText("");
        setExpectedText("");
        setFormError(null);
      },
      onError: (err) => setFormError(err.message),
    }),
  );

  const deleteMutation = useMutation(
    trpc.vrl.deleteUnitTest.mutationOptions({
      onSuccess: (_data, vars) => {
        queryClient.invalidateQueries({ queryKey: listKey });
        setResults((prev) => prev.filter((r) => r.id !== vars.id));
      },
    }),
  );

  const runMutation = useMutation(
    trpc.vrl.runUnitTests.mutationOptions({
      onSuccess: (data) => setResults(data),
    }),
  );

  const resultById = useMemo(() => {
    const map = new Map<string, RunResult>();
    for (const r of results) map.set(r.id, r);
    return map;
  }, [results]);

  const handleCreate = useCallback(() => {
    setFormError(null);
    let parsedInput: unknown;
    let parsedExpected: unknown;
    try {
      parsedInput = JSON.parse(inputText);
    } catch {
      setFormError("Input is not valid JSON");
      return;
    }
    try {
      parsedExpected = JSON.parse(expectedText);
    } catch {
      setFormError("Expected output is not valid JSON");
      return;
    }
    const isObject = (v: unknown) =>
      v !== null && typeof v === "object" && !Array.isArray(v);
    if (!isObject(parsedInput)) {
      setFormError("Input must be a JSON object (a single event)");
      return;
    }
    if (!isObject(parsedExpected)) {
      setFormError("Expected output must be a JSON object");
      return;
    }
    createMutation.mutate({
      pipelineId,
      componentKey,
      name: name.trim() || "Untitled test",
      input: parsedInput as Record<string, unknown>,
      expected: parsedExpected as Record<string, unknown>,
    });
  }, [inputText, expectedText, name, pipelineId, componentKey, createMutation]);

  const tests = listQuery.data ?? [];
  const passedCount = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed);

  return (
    <div className="space-y-3 rounded border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-semibold">Unit tests</Label>
        <div className="flex items-center gap-1.5">
          {results.length > 0 && (
            <Badge
              variant={passedCount === results.length ? "secondary" : "destructive"}
              className="text-xs"
            >
              {passedCount}/{results.length} passed
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              runMutation.mutate({ pipelineId, componentKey, source })
            }
            disabled={runMutation.isPending || tests.length === 0}
          >
            {runMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            Run all
          </Button>
        </div>
      </div>

      {tests.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground">
          No saved tests. Add an input → expected pair to pin a regression case
          for this transform.
        </p>
      )}

      {tests.length > 0 && (
        <ul className="space-y-1">
          {tests.map((test) => {
            const result = resultById.get(test.id);
            return (
              <li
                key={test.id}
                className="flex items-center justify-between gap-2 rounded bg-muted/30 px-2 py-1"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  {result ? (
                    result.passed ? (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-status-success"
                        aria-label="passed"
                      />
                    ) : (
                      <X
                        className="h-3.5 w-3.5 shrink-0 text-status-error"
                        aria-label="failed"
                      />
                    )
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate text-xs">{test.name}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  aria-label={`Delete ${test.name}`}
                  onClick={() => deleteMutation.mutate({ id: test.id })}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {failed.length > 0 && (
        <div className="space-y-1.5">
          {failed.map((r) => (
            <div
              key={r.id}
              className="rounded border border-status-error/30 bg-status-error-bg p-2"
            >
              <p className="text-xs font-medium text-status-error">
                {r.name} — failed
              </p>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground">
                    Expected
                  </Label>
                  <pre className="max-h-24 overflow-auto rounded bg-muted/40 p-1 font-mono text-[10px]">
                    {JSON.stringify(r.expected, null, 2)}
                  </pre>
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground">
                    Actual
                  </Label>
                  <pre className="max-h-24 overflow-auto rounded bg-muted/40 p-1 font-mono text-[10px]">
                    {r.actual === null
                      ? "(no output — dropped or compile error)"
                      : JSON.stringify(r.actual, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="space-y-2 rounded border p-2">
          <div className="space-y-1">
            <Label htmlFor="vrl-test-name" className="text-xs">
              Name
            </Label>
            <Input
              id="vrl-test-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 text-xs"
              placeholder="e.g. drops debug logs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vrl-test-input" className="text-xs">
              Input (JSON event)
            </Label>
            <textarea
              id="vrl-test-input"
              className="w-full rounded border bg-muted/30 p-2 font-mono text-xs"
              rows={4}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={'{"message": "hello", "level": "debug"}'}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vrl-test-expected" className="text-xs">
              Expected output (JSON)
            </Label>
            <textarea
              id="vrl-test-expected"
              className="w-full rounded border bg-muted/30 p-2 font-mono text-xs"
              rows={4}
              value={expectedText}
              onChange={(e) => setExpectedText(e.target.value)}
              placeholder={'{"message": "hello", "level": "info"}'}
            />
          </div>
          {formError && <p className="text-xs text-status-error">{formError}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Saving..." : "Save test"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setShowForm(true);
            if (initialInput && !inputText) setInputText(initialInput);
          }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add test
        </Button>
      )}
    </div>
  );
}
