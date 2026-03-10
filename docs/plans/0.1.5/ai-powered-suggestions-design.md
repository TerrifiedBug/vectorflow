# AI-Powered Suggestions — Design Spec

**Date:** 2026-03-10
**Status:** Approved
**Scope:** VRL writing assistant + AI pipeline builder using OpenAI-compatible API with streaming responses

---

## Overview

Add AI-powered assistance to VectorFlow in two areas:

1. **VRL Assistant** — Natural language → VRL code generation, inline in the VRL editor
2. **Pipeline Builder** — Natural language → full Vector pipeline generation, rendered on canvas

Both use an OpenAI-compatible API (works with OpenAI, Anthropic, Ollama, Groq, Together, etc.) configured per team by admins.

### Goals
- OpenAI-compatible API format for maximum provider flexibility
- Per-team AI configuration (admin sets credentials, team members use it)
- VRL assistant with live schema context for accurate code generation
- Pipeline builder reusing existing `importVectorConfig()` for canvas rendering
- Streaming responses for responsive UX
- Static knowledge sources (VRL reference + Vector component schema) shipped with server

### Non-Goals (v1)
- MCP server for VectorFlow (future — enables Claude/Cursor troubleshooting)
- Config troubleshooter (AI analyzes crash logs + suggests fixes)
- Conversation history / multi-turn refinement
- Fine-tuned models for Vector/VRL

---

## 1. AI Provider Configuration

### Team-Level Settings

AI credentials configured per team by admins. Available within that team's environments.

**Schema change — `Team` table:**

```prisma
aiProvider        String?   // "openai" | "anthropic" | "custom"
aiBaseUrl         String?   // OpenAI-compatible API endpoint
aiApiKey          String?   // encrypted (AES-256, same as secrets)
aiModel           String?   // e.g. "gpt-4o", "claude-sonnet-4-20250514"
aiEnabled         Boolean   @default(false)
```

- `aiBaseUrl` defaults to `https://api.openai.com/v1` if not set
- `aiApiKey` encrypted at rest using existing `config-crypto.ts`
- `aiEnabled` — master toggle, allows disabling without removing credentials

### Settings UI

New "AI" section in team settings (ADMIN only):
- Provider selector (OpenAI / Anthropic / Custom)
- Base URL field (pre-filled for known providers, editable for custom)
- API key field (password masked)
- Model name field
- Enable/disable toggle
- "Test Connection" button — validates with a simple completion request

---

## 2. Knowledge Sources

### Static Knowledge — Built at Docker Image Build Time

**VRL Function Reference:** `src/lib/ai/vrl-reference.txt`
- Compact format: signature + one-line description + one example per function
- ~200 functions, ~3,000-4,000 tokens
- Manually curated from Vector's public VRL documentation (Mozilla Public License 2.0)
- Updated when Vector version is bumped in the Dockerfile

**Vector Component Schema:** `src/lib/ai/vector-schema.json`
- Generated at build time via `vector generate-schema > src/lib/ai/vector-schema.json`
- Added as a Dockerfile build step
- Full schema of every component (sources, transforms, sinks) with fields, types, defaults
- At runtime, only relevant component schemas are injected into the prompt (not the full file)

### Dynamic Context — Per Request

**VRL Assistant context:**
- Current VRL code in the editor
- Available fields + types (from Fetch Samples schema or source output schema)
- Component type of the transform
- Connected source types (data shape awareness)

**Pipeline Builder context:**
- User's environment name (for meaningful component naming)
- Existing pipeline nodes (if adding to existing pipeline)
- Available Vector component types from catalog

### System Prompt Structure

```
[VRL Assistant]
System: You are a VRL code assistant for Vector pipelines.
  {vrl-reference.txt}

  User's available fields:
  {fields from schema/samples}

  Current VRL code:
  {editor contents}

  Generate VRL code. Output only the code, no explanation.

[Pipeline Builder]
System: You are a Vector pipeline generator.
  Generate valid Vector YAML config with sources, transforms, and sinks sections.

  Available component schemas:
  {relevant subset of vector-schema.json}

  Output only valid Vector YAML. No explanation or markdown fencing.
```

---

## 3. API Layer

### AI Service

**New service: `src/server/services/ai.ts`**

```typescript
interface AIService {
  streamCompletion(params: {
    teamId: string;
    systemPrompt: string;
    userPrompt: string;
    onToken: (token: string) => void;
  }): Promise<void>;
}
```

- Reads AI config from team settings
- Decrypts API key via existing crypto service
- Calls `POST {baseUrl}/chat/completions` with `stream: true`
- Parses SSE chunks, calls `onToken` per token
- Throws if AI not enabled for team

### Streaming Endpoints (Next.js Route Handlers)

tRPC doesn't natively support SSE, so these are standard route handlers.

**`POST /api/ai/vrl`** — VRL Assistant
- Input: `{ teamId, pipelineId, nodeId, prompt, currentCode, fields }`
- Auth: EDITOR+ (validated via session)
- Builds system prompt with VRL reference + field context
- Streams response as SSE (`text/event-stream`)
- Each event: `data: {"token": "..."}\n\n`
- Final event: `data: {"done": true}\n\n`

**`POST /api/ai/pipeline`** — Pipeline AI (generate + review)
- Input: `{ teamId, environmentId, pipelineId?, prompt, currentYaml? }`
- Auth: EDITOR+
- If `currentYaml` provided: review/improve mode (AI analyzes existing config)
- If no `currentYaml`: generate mode (AI creates new pipeline YAML)
- Builds system prompt with component schema context
- Streams response as SSE
- Client determines response type: YAML (for generate) → `importVectorConfig()`, or text (for review)

### Rate Limiting

- Per-team rate limit: configurable, default 60 requests/hour
- Prevents runaway API costs
- Tracked in memory (simple token bucket)

---

## 4. UI Integration

### VRL Assistant — In the VRL Editor

**Location:** `src/components/vrl-editor/vrl-editor.tsx`

- New "AI" button in VRL editor toolbar (sparkle icon)
- Clicking opens inline text input below toolbar: "Describe what you want..."
- User types natural language, presses Enter
- VRL code streams into a preview area below the input
- Two buttons: "Insert" (appends to editor) / "Replace" (replaces editor content)
- "Regenerate" button to retry with same prompt
- If AI not enabled for team, button is hidden

**Context gathering (automatic):**
- Current editor content → `currentCode`
- Fields panel data (from Fetch Samples) → `fields`

### Pipeline AI — In the Flow Toolbar

**Location:** `src/components/flow/flow-toolbar.tsx`

- New AI icon button in toolbar (sparkle icon)
- Clicking opens modal/drawer with chat-style input
- Supports two modes via the same interface:

**Generate mode** (empty or existing pipeline):
- "Collect K8s logs, drop debug, send to Datadog and S3"
- AI generates Vector YAML → `importVectorConfig()` → nodes + edges on canvas
- If pipeline has existing nodes: new nodes added alongside (not replacing)
- If empty pipeline: nodes become the initial graph
- Auto-layout via dagre

**Review/improve mode** (existing pipeline):
- "Is my pipeline config optimal?"
- "Can I improve my buffering settings?"
- "What's wrong with my sink config?"
- AI receives the current pipeline YAML (generated from canvas via existing `generateVectorYaml()`) + component schema context
- Responds with suggestions as text (not YAML replacement)
- User applies suggestions manually or clicks "Apply" if AI provides a revised YAML

**Context (automatic):**
- Current pipeline YAML (via `generateVectorYaml()`)
- Component schemas for components in use
- Pipeline status/errors if available

**Error handling:**
- Invalid YAML: show error + raw YAML, let user copy/edit
- AI request fails: error message + "Retry" button
- Loading: streaming indicator

### Empty Pipeline State

When pipeline has no nodes and AI is enabled:
- Existing: "Drag components from the palette"
- New: "Or describe what you want to build" with inline AI prompt input

### AI Availability

- AI configured: sparkle icons visible in toolbar and VRL editor
- AI not configured: no AI UI shown anywhere (clean, no upsell)
- Settings page: "AI not configured" with link to team settings for admins

---

## 5. Key Files

### New Files

| File | Purpose |
|---|---|
| `src/lib/ai/vrl-reference.txt` | Compact VRL function reference (~200 functions) |
| `src/lib/ai/vector-schema.json` | Generated at build time via `vector generate-schema` |
| `src/server/services/ai.ts` | LLM communication service (OpenAI-compatible) |
| `src/app/api/ai/vrl/route.ts` | SSE endpoint for VRL assistant |
| `src/app/api/ai/pipeline/route.ts` | SSE endpoint for pipeline builder |
| `src/components/vrl-editor/ai-input.tsx` | Inline AI prompt + streaming preview |
| `src/components/flow/ai-pipeline-dialog.tsx` | Pipeline builder modal with YAML preview |
| `src/components/settings/ai-section.tsx` | Team AI configuration UI |

### Modified Files

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add AI fields to Team model |
| `src/components/vrl-editor/vrl-editor.tsx` | Add AI button + integration |
| `src/components/flow/flow-toolbar.tsx` | Add AI icon button |
| `src/components/flow/flow-canvas.tsx` | Enhanced empty state with AI prompt |
| `docker/server/Dockerfile` | Add `vector generate-schema` build step |

---

## 6. Future Direction: MCP Server

A VectorFlow MCP server would expose tools for conversational troubleshooting via Claude Desktop, Cursor, or other MCP-compatible clients:

- `get_pipeline_status` — current state of all pipelines
- `get_pipeline_logs` — recent logs for a pipeline
- `get_pipeline_config` — current YAML config
- `deploy_pipeline` — trigger a deploy
- `get_errors` — recent errors across all pipelines

Separate design spec when ready.
