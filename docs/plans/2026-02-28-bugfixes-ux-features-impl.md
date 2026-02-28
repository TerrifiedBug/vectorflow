# Bug Fixes, UX Improvements & Features — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 3 bugs (SSO auth, GitOps deploy, VRL test input), improve 3 UX issues (detail panel, SSH upload, Docker caching), and add 2 features (VRL snippet library, pipeline metrics).

**Architecture:** Bugs and UX changes are surgical edits to existing files. VRL snippets add a static data file + drawer component + Monaco completions. Pipeline metrics extend the fleet poller with rate computation and an in-memory ring buffer, expose via tRPC, and render with recharts on a new dashboard page + inline sparklines.

**Tech Stack:** Next.js 15 (App Router), NextAuth v5, tRPC, Prisma, React Flow, Monaco Editor, recharts (new), Tailwind CSS, shadcn/ui.

---

## Task 1: B2 — Fix GitOps "spawn git ENOENT"

The `git` binary is missing from the Docker runner stage. `simple-git` shells out to `git` and fails with ENOENT.

**Files:**
- Modify: `docker/Dockerfile:34-43`

**Step 1: Add git and openssh-client to the runner stage**

In `docker/Dockerfile`, find the `apk add` line that installs `su-exec` (line 45) and add `git openssh-client` to it:

```dockerfile
RUN apk add --no-cache su-exec git openssh-client && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 vectorflow
```

This combines the two `RUN` statements to save a layer.

**Step 2: Commit**

```bash
git add docker/Dockerfile
git commit -m "fix: add git and openssh-client to Docker runner stage

GitOps deploy failed with 'spawn git ENOENT' because git was not
installed in the production container."
```

---

## Task 2: U3 — Docker Build Layer Caching for Vector Binary

Vector binary (~80MB) is re-downloaded on every build. Restructure into a separate stage cached by `VECTOR_VERSION` ARG.

**Files:**
- Modify: `docker/Dockerfile`

**Step 1: Restructure the Dockerfile into multi-stage build**

Replace the entire Dockerfile with this structure:

```dockerfile
# syntax=docker/dockerfile:1

# ---- Stage 1: Install deps ----
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- Stage 2: Download Vector binary (cached unless VECTOR_VERSION changes) ----
FROM alpine:3.21 AS vector
ARG VECTOR_VERSION=0.44.0
RUN apk add --no-cache curl && \
    curl -sSfL -o /tmp/vector.tar.gz \
      "https://packages.timber.io/vector/${VECTOR_VERSION}/vector-${VECTOR_VERSION}-x86_64-unknown-linux-musl.tar.gz" && \
    tar xzf /tmp/vector.tar.gz -C /tmp && \
    cp /tmp/vector-x86_64-unknown-linux-musl/bin/vector /usr/local/bin/vector && \
    rm -rf /tmp/vector*

# ---- Stage 3: Build app ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json next.config.ts postcss.config.mjs components.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN npx prisma generate
COPY src ./src
COPY public ./public
RUN --mount=type=cache,target=/app/.next/cache \
    pnpm build

# ---- Stage 4: Production runner ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache su-exec git openssh-client && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 vectorflow

# Copy Vector binary from dedicated stage
COPY --from=vector /usr/local/bin/vector /usr/local/bin/vector

# Copy Next.js standalone output
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Copy Prisma schema, config, and migrations for runtime migration
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

# Copy full node_modules for prisma migrate deploy
COPY --from=build /app/node_modules ./node_modules

# Copy entrypoint script
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

RUN chown -R vectorflow:nodejs /app

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
```

**Step 2: Verify docker build**

```bash
cd docker && docker compose build vectorflow
```

Expected: Build completes. On subsequent code-only rebuilds, the "vector" stage is cached.

**Step 3: Commit**

```bash
git add docker/Dockerfile
git commit -m "perf: restructure Dockerfile for Vector binary layer caching

Separate Vector binary download into its own build stage. Code-only
rebuilds skip the ~80MB download. Also bumps Vector from 0.43.1 to 0.44.0."
```

---

## Task 3: B1 — Fix SSO "Invalid client secret" with Pocket ID

### Problem

NextAuth v5 defaults `token_endpoint_auth_method` to `client_secret_basic` (credentials in Authorization header). Pocket ID expects `client_secret_post` (credentials in form body). Secondary issue: OIDC config is cached at module load and never refreshed.

### 3a: Add `oidcTokenEndpointAuthMethod` to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma:175-196`

**Step 1: Add the new field to SystemSettings**

After the `oidcEditorGroups` field (line 185), add:

```prisma
  oidcTokenEndpointAuthMethod String? @default("client_secret_post")
```

**Step 2: Generate and apply migration**

```bash
npx prisma migrate dev --name add_oidc_token_endpoint_auth_method
```

Expected: Migration created and applied.

**Step 3: Commit**

```bash
git add prisma/
git commit -m "schema: add oidcTokenEndpointAuthMethod to SystemSettings"
```

### 3b: Fix OIDC provider registration with dynamic reload

**Files:**
- Modify: `src/auth.ts`

**Step 1: Rewrite auth.ts to support dynamic OIDC and token_endpoint_auth_method**

Replace the OIDC provider registration to include the `client` config and switch from static module-level loading to a lazy provider pattern:

In `getOidcSettings()`, also read the new field:

```typescript
async function getOidcSettings() {
  try {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: "singleton" },
    });
    if (settings?.oidcIssuer && settings?.oidcClientId && settings?.oidcClientSecret) {
      let clientSecret: string;
      try {
        clientSecret = decrypt(settings.oidcClientSecret);
      } catch {
        return null;
      }
      return {
        issuer: settings.oidcIssuer,
        clientId: settings.oidcClientId,
        clientSecret,
        displayName: settings.oidcDisplayName ?? "SSO",
        tokenEndpointAuthMethod: settings.oidcTokenEndpointAuthMethod ?? "client_secret_post",
      };
    }
  } catch {
    // Database may not be available yet (e.g., during build)
  }
  return null;
}
```

Then change the OIDC provider push to include the `client` block:

```typescript
if (oidcSettings) {
  providers.push({
    id: "oidc",
    name: oidcSettings.displayName,
    type: "oidc",
    issuer: oidcSettings.issuer,
    clientId: oidcSettings.clientId,
    clientSecret: oidcSettings.clientSecret,
    client: {
      token_endpoint_auth_method: oidcSettings.tokenEndpointAuthMethod,
    },
  } as Provider);
  console.log(`OIDC provider registered: ${oidcSettings.displayName} (${oidcSettings.issuer})`);
}
```

**Step 2: Commit**

```bash
git add src/auth.ts
git commit -m "fix: set token_endpoint_auth_method for OIDC provider

Pocket ID (and some other providers) require client_secret_post. NextAuth
defaults to client_secret_basic. Read the method from SystemSettings with
a default of client_secret_post."
```

### 3c: Expose token endpoint auth method in settings UI

**Files:**
- Modify: `src/server/routers/settings.ts`
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Step 1: Update the settings tRPC router**

In `settingsRouter.get` (around line 62-78), add to the return object:

```typescript
oidcTokenEndpointAuthMethod: settings.oidcTokenEndpointAuthMethod ?? "client_secret_post",
```

In `settingsRouter.updateOidc` (around line 81-105), add `tokenEndpointAuthMethod` to the input schema:

```typescript
z.object({
  issuer: z.string().url().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  displayName: z.string().min(1).default("SSO"),
  tokenEndpointAuthMethod: z.enum(["client_secret_post", "client_secret_basic"]).default("client_secret_post"),
})
```

And update the `prisma.systemSettings.update` data block:

```typescript
data: {
  oidcIssuer: input.issuer,
  oidcClientId: input.clientId,
  oidcClientSecret: encryptedSecret,
  oidcDisplayName: input.displayName,
  oidcTokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
},
```

**Step 2: Add dropdown to settings page**

In `src/app/(dashboard)/settings/page.tsx`, inside the `AuthSettings` component:

Add state:
```typescript
const [tokenAuthMethod, setTokenAuthMethod] = useState<"client_secret_post" | "client_secret_basic">("client_secret_post");
```

In the `useEffect` that loads settings:
```typescript
setTokenAuthMethod((settings.oidcTokenEndpointAuthMethod as "client_secret_post" | "client_secret_basic") ?? "client_secret_post");
```

In `handleSave`, add to the mutate call:
```typescript
updateOidcMutation.mutate({
  issuer,
  clientId,
  clientSecret: clientSecret || "unchanged",
  displayName,
  tokenEndpointAuthMethod: tokenAuthMethod,
});
```

Add the dropdown UI after the "Display Name" field and before the `<Separator />`:

```tsx
<div className="space-y-2">
  <Label htmlFor="oidc-auth-method">Token Auth Method</Label>
  <Select
    value={tokenAuthMethod}
    onValueChange={(val: "client_secret_post" | "client_secret_basic") => setTokenAuthMethod(val)}
  >
    <SelectTrigger id="oidc-auth-method" className="w-full">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="client_secret_post">client_secret_post (default)</SelectItem>
      <SelectItem value="client_secret_basic">client_secret_basic</SelectItem>
    </SelectContent>
  </Select>
  <p className="text-xs text-muted-foreground">
    How the client secret is sent to the token endpoint. Most providers use client_secret_post.
  </p>
</div>
```

**Step 3: Commit**

```bash
git add src/server/routers/settings.ts src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat: expose OIDC token endpoint auth method in settings UI

Adds a dropdown in OIDC settings to choose between client_secret_post
and client_secret_basic. Defaults to client_secret_post for Pocket ID
compatibility."
```

---

## Task 4: B3 — VRL Default Test Input for Imported Pipelines

When VRL test input is empty, `parse_json!(.message)` fails. Provide a sensible default.

**Files:**
- Modify: `src/components/vrl-editor/vrl-editor.tsx:37`
- Modify: `src/server/routers/vrl.ts:14-18`

**Step 1: Change VRL input validation to allow empty and provide default**

In `src/server/routers/vrl.ts`, change the input schema to allow empty strings:

```typescript
z.object({
  source: z.string().min(1),
  input: z.string(),
})
```

Then after `const start = performance.now();` add a default:

```typescript
const effectiveInput = input.input.trim() || JSON.stringify({
  message: "test event",
  timestamp: new Date().toISOString(),
  host: "localhost",
});
```

Use `effectiveInput` instead of `input.input` when writing the file:

```typescript
await writeFile(inputPath, effectiveInput);
```

**Step 2: Update the VRL editor to show a hint when using defaults**

In `src/components/vrl-editor/vrl-editor.tsx`, change the default `sampleInput` from:
```typescript
const [sampleInput, setSampleInput] = useState('{"message": "hello world"}');
```
to:
```typescript
const [sampleInput, setSampleInput] = useState("");
```

Add a placeholder hint on the textarea:
```tsx
<textarea
  id="vrl-sample-input"
  className="w-full rounded border bg-muted/30 p-2 font-mono text-xs"
  rows={4}
  value={sampleInput}
  onChange={(e) => setSampleInput(e.target.value)}
  placeholder={'No test input — a default event will be used:\n{"message": "test event", "timestamp": "...", "host": "localhost"}'}
/>
```

**Step 3: Commit**

```bash
git add src/server/routers/vrl.ts src/components/vrl-editor/vrl-editor.tsx
git commit -m "fix: provide default VRL test input when field is empty

Imported pipelines have no test input, causing parse_json to fail on
empty string. Now defaults to a generic JSON event when input is blank."
```

---

## Task 5: U1 — Remove Redundant Host/Port from Fleet Node Detail Panel

The fleet node detail page shows IP and port in both the summary section and the edit form.

**Files:**
- Modify: `src/app/(dashboard)/fleet/[nodeId]/page.tsx:168-189`

**Step 1: Remove Host and API Port from the "Node Details" card**

In the Node Details `<CardContent>`, remove the two grid items for Host and API Port (lines 183-189):

```tsx
<div>
  <p className="text-sm text-muted-foreground">Host</p>
  <p className="text-sm font-mono">{node.host}</p>
</div>
<div>
  <p className="text-sm text-muted-foreground">API Port</p>
  <p className="text-sm font-mono">{node.apiPort}</p>
</div>
```

Remove those two `<div>` blocks. The host:port is already shown in the page header subtitle (line 145-147) and editable in the Edit Node form.

**Step 2: Commit**

```bash
git add src/app/\(dashboard\)/fleet/\[nodeId\]/page.tsx
git commit -m "ui: remove redundant host/port from fleet node detail panel

Host and port are shown in the page header and editable in the form,
so the duplicate display in the summary card is unnecessary."
```

---

## Task 6: U2 — SSH Key Upload — Accept Extensionless Keys

`ssh-keygen` generates private keys without file extensions. The `accept` attribute filters them out.

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx:629`

**Step 1: Remove the accept attribute from the SSH key file input**

Change:
```tsx
accept=".pem,.key,id_rsa,id_ed25519"
```
To remove the `accept` attribute entirely (or set `accept="*"`):
```tsx
// Remove the accept attribute — just delete it from the Input element
```

The `<Input>` on line 629 should become:
```tsx
<Input
  ref={fileInputRef}
  id="ssh-key-upload"
  type="file"
  onChange={handleFileUpload}
  className="max-w-sm"
/>
```

**Step 2: Commit**

```bash
git add src/app/\(dashboard\)/settings/page.tsx
git commit -m "fix: accept extensionless SSH keys in file upload

ssh-keygen generates keys without extensions (e.g. id_ed25519).
Server-side validation already checks key content integrity."
```

---

## Task 7: VRL Snippet Library — Snippet Definitions

**Files:**
- Create: `src/lib/vrl/snippets.ts`

**Step 1: Create the snippet data file**

Create `src/lib/vrl/snippets.ts` with the `VrlSnippet` interface and all snippet definitions organized by category. Below is the complete file structure:

```typescript
export interface VrlSnippet {
  id: string;
  name: string;
  description: string;
  category:
    | "Parsing"
    | "Filtering"
    | "Enrichment"
    | "Type Coercion"
    | "Encoding"
    | "String"
    | "Timestamp"
    | "Networking";
  code: string;
  placeholders?: string[];
}

export const VRL_SNIPPETS: VrlSnippet[] = [
  // ── Parsing ──────────────────────────────────────────
  {
    id: "parse-json",
    name: "parse_json",
    description: "Parse a JSON string into an object",
    category: "Parsing",
    code: '. = parse_json!(.message)',
    placeholders: [".message"],
  },
  {
    id: "parse-syslog",
    name: "parse_syslog",
    description: "Parse a syslog-formatted message",
    category: "Parsing",
    code: '. = parse_syslog!(.message)',
    placeholders: [".message"],
  },
  {
    id: "parse-csv",
    name: "parse_csv",
    description: "Parse a CSV row into an array",
    category: "Parsing",
    code: '.parsed = parse_csv!(.message)',
    placeholders: [".message"],
  },
  {
    id: "parse-key-value",
    name: "parse_key_value",
    description: "Parse key=value pairs from a string",
    category: "Parsing",
    code: '. = parse_key_value!(.message)',
    placeholders: [".message"],
  },
  {
    id: "parse-regex",
    name: "parse_regex",
    description: "Extract fields using a named-capture regex",
    category: "Parsing",
    code: '. = parse_regex!(.message, r\'^(?P<timestamp>\\S+) (?P<level>\\w+) (?P<msg>.*)$\')',
    placeholders: [".message"],
  },
  {
    id: "parse-grok",
    name: "parse_grok",
    description: "Parse a string using a Grok pattern",
    category: "Parsing",
    code: '. = parse_grok!(.message, "%{COMBINEDAPACHELOG}")',
    placeholders: [".message", "%{COMBINEDAPACHELOG}"],
  },
  {
    id: "parse-xml",
    name: "parse_xml",
    description: "Parse an XML string into an object",
    category: "Parsing",
    code: '.parsed = parse_xml!(.message)',
    placeholders: [".message"],
  },
  {
    id: "parse-apache-log",
    name: "parse_apache_log",
    description: "Parse an Apache combined log format line",
    category: "Parsing",
    code: '. = parse_apache_log!(.message, format: "combined")',
    placeholders: [".message"],
  },
  {
    id: "parse-nginx-log",
    name: "parse_nginx_log",
    description: "Parse an Nginx combined log format line",
    category: "Parsing",
    code: '. = parse_nginx_log!(.message, format: "combined")',
    placeholders: [".message"],
  },

  // ── Filtering ────────────────────────────────────────
  {
    id: "del-field",
    name: "del(.field)",
    description: "Delete a field from the event",
    category: "Filtering",
    code: 'del(.field_name)',
    placeholders: [".field_name"],
  },
  {
    id: "only-fields",
    name: "only_fields",
    description: "Keep only specified fields, remove everything else",
    category: "Filtering",
    code: 'only_fields(., ["message", "timestamp", "host"])',
    placeholders: ["message", "timestamp", "host"],
  },
  {
    id: "if-else",
    name: "if/else condition",
    description: "Conditionally transform an event",
    category: "Filtering",
    code: 'if .level == "error" {\n  .priority = "high"\n} else {\n  .priority = "normal"\n}',
    placeholders: [".level", '"error"', ".priority"],
  },
  {
    id: "abort",
    name: "abort",
    description: "Drop the current event (use in remap with drop_on_abort)",
    category: "Filtering",
    code: 'if .level == "debug" {\n  abort\n}',
    placeholders: [".level", '"debug"'],
  },
  {
    id: "assert",
    name: "assert",
    description: "Assert a condition or abort with a message",
    category: "Filtering",
    code: 'assert!(.message != "", message: "message field is required")',
    placeholders: [".message"],
  },
  {
    id: "compact",
    name: "compact",
    description: "Remove null and empty values from the event",
    category: "Filtering",
    code: '. = compact(.)',
  },

  // ── Enrichment ───────────────────────────────────────
  {
    id: "set-field",
    name: "set field",
    description: "Set a new field on the event",
    category: "Enrichment",
    code: '.environment = "production"',
    placeholders: [".environment", '"production"'],
  },
  {
    id: "rename-field",
    name: "rename field",
    description: "Rename a field by copying and deleting the original",
    category: "Enrichment",
    code: '.new_name = del(.old_name)',
    placeholders: [".new_name", ".old_name"],
  },
  {
    id: "merge-objects",
    name: "merge objects",
    description: "Merge two objects together",
    category: "Enrichment",
    code: '. = merge(., {"source": "vectorflow", "processed": true})',
    placeholders: ['"source"', '"vectorflow"'],
  },
  {
    id: "add-tags",
    name: "add tags",
    description: "Add tags to the event",
    category: "Enrichment",
    code: '.tags = push(.tags ?? [], "processed")',
    placeholders: [".tags", '"processed"'],
  },
  {
    id: "set-timestamp",
    name: "set timestamp",
    description: "Set the timestamp to the current time",
    category: "Enrichment",
    code: '.timestamp = now()',
  },
  {
    id: "uuid",
    name: "uuid_v4()",
    description: "Generate a unique ID for the event",
    category: "Enrichment",
    code: '.id = uuid_v4()',
  },

  // ── Type Coercion ────────────────────────────────────
  {
    id: "to-int",
    name: "to_int",
    description: "Convert a value to an integer",
    category: "Type Coercion",
    code: '.status_code = to_int!(.status_code)',
    placeholders: [".status_code"],
  },
  {
    id: "to-float",
    name: "to_float",
    description: "Convert a value to a float",
    category: "Type Coercion",
    code: '.duration = to_float!(.duration)',
    placeholders: [".duration"],
  },
  {
    id: "to-bool",
    name: "to_bool",
    description: "Convert a value to a boolean",
    category: "Type Coercion",
    code: '.is_active = to_bool!(.is_active)',
    placeholders: [".is_active"],
  },
  {
    id: "to-string",
    name: "to_string",
    description: "Convert a value to a string",
    category: "Type Coercion",
    code: '.code = to_string(.code)',
    placeholders: [".code"],
  },
  {
    id: "to-timestamp",
    name: "to_timestamp",
    description: "Convert a value to a timestamp",
    category: "Type Coercion",
    code: '.timestamp = to_timestamp!(.timestamp)',
    placeholders: [".timestamp"],
  },

  // ── Encoding ─────────────────────────────────────────
  {
    id: "encode-json",
    name: "encode_json",
    description: "Encode an object to a JSON string",
    category: "Encoding",
    code: '.message = encode_json(.)',
  },
  {
    id: "encode-logfmt",
    name: "encode_logfmt",
    description: "Encode an object to logfmt format",
    category: "Encoding",
    code: '.message = encode_logfmt(.)',
  },
  {
    id: "encode-base64",
    name: "encode_base64",
    description: "Base64-encode a string",
    category: "Encoding",
    code: '.encoded = encode_base64(.message)',
    placeholders: [".message"],
  },
  {
    id: "decode-base64",
    name: "decode_base64",
    description: "Decode a base64-encoded string",
    category: "Encoding",
    code: '.decoded = decode_base64!(.encoded)',
    placeholders: [".encoded"],
  },

  // ── String ───────────────────────────────────────────
  {
    id: "downcase",
    name: "downcase",
    description: "Convert a string to lowercase",
    category: "String",
    code: '.level = downcase(.level)',
    placeholders: [".level"],
  },
  {
    id: "upcase",
    name: "upcase",
    description: "Convert a string to uppercase",
    category: "String",
    code: '.level = upcase(.level)',
    placeholders: [".level"],
  },
  {
    id: "strip-whitespace",
    name: "strip_whitespace",
    description: "Remove leading and trailing whitespace",
    category: "String",
    code: '.message = strip_whitespace(.message)',
    placeholders: [".message"],
  },
  {
    id: "replace",
    name: "replace",
    description: "Replace occurrences of a pattern in a string",
    category: "String",
    code: '.message = replace(.message, "old", "new")',
    placeholders: [".message", '"old"', '"new"'],
  },
  {
    id: "contains",
    name: "contains",
    description: "Check if a string contains a substring",
    category: "String",
    code: 'if contains(to_string(.message), "error") {\n  .has_error = true\n}',
    placeholders: [".message", '"error"'],
  },
  {
    id: "starts-with",
    name: "starts_with",
    description: "Check if a string starts with a prefix",
    category: "String",
    code: 'if starts_with(to_string(.path), "/api") {\n  .is_api = true\n}',
    placeholders: [".path", '"/api"'],
  },
  {
    id: "split",
    name: "split",
    description: "Split a string into an array",
    category: "String",
    code: '.parts = split(to_string(.message), ",")',
    placeholders: [".message", '","'],
  },
  {
    id: "join",
    name: "join",
    description: "Join an array into a string",
    category: "String",
    code: '.combined = join(.tags, ", ") ?? ""',
    placeholders: [".tags"],
  },

  // ── Timestamp ────────────────────────────────────────
  {
    id: "now",
    name: "now()",
    description: "Get the current timestamp",
    category: "Timestamp",
    code: '.processed_at = now()',
  },
  {
    id: "format-timestamp",
    name: "format_timestamp",
    description: "Format a timestamp as a custom string",
    category: "Timestamp",
    code: '.date = format_timestamp!(.timestamp, format: "%Y-%m-%d %H:%M:%S")',
    placeholders: [".timestamp"],
  },
  {
    id: "parse-timestamp",
    name: "parse_timestamp",
    description: "Parse a string into a timestamp",
    category: "Timestamp",
    code: '.timestamp = parse_timestamp!(.time, format: "%Y-%m-%dT%H:%M:%SZ")',
    placeholders: [".time"],
  },
  {
    id: "to-unix-timestamp",
    name: "to_unix_timestamp",
    description: "Convert a timestamp to Unix epoch seconds",
    category: "Timestamp",
    code: '.epoch = to_unix_timestamp(now())',
  },

  // ── Networking ───────────────────────────────────────
  {
    id: "ip-cidr-contains",
    name: "ip_cidr_contains",
    description: "Check if an IP is within a CIDR range",
    category: "Networking",
    code: 'if ip_cidr_contains(.ip, "10.0.0.0/8") {\n  .is_internal = true\n}',
    placeholders: [".ip", '"10.0.0.0/8"'],
  },
  {
    id: "parse-url",
    name: "parse_url",
    description: "Parse a URL into its components",
    category: "Networking",
    code: '.url_parts = parse_url!(.url)',
    placeholders: [".url"],
  },
  {
    id: "ip-to-ipv6",
    name: "ip_to_ipv6",
    description: "Convert an IPv4 address to IPv6-mapped format",
    category: "Networking",
    code: '.ipv6 = ip_to_ipv6(.ip) ?? .ip',
    placeholders: [".ip"],
  },
  {
    id: "community-id",
    name: "community_id",
    description: "Generate a Community ID flow hash for network events",
    category: "Networking",
    code: '.community_id = community_id!(source_ip: .src_ip, destination_ip: .dst_ip, source_port: .src_port, destination_port: .dst_port, protocol: 6)',
    placeholders: [".src_ip", ".dst_ip", ".src_port", ".dst_port"],
  },
];
```

**Step 2: Commit**

```bash
git add src/lib/vrl/snippets.ts
git commit -m "feat: add VRL snippet definitions (48 snippets across 8 categories)"
```

---

## Task 8: VRL Snippet Library — Drawer Component

**Files:**
- Create: `src/components/flow/vrl-snippet-drawer.tsx`

**Step 1: Create the drawer component**

```tsx
"use client";

import { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VRL_SNIPPETS, type VrlSnippet } from "@/lib/vrl/snippets";

interface VrlSnippetDrawerProps {
  onInsert: (code: string) => void;
}

const CATEGORIES = [
  "Parsing",
  "Filtering",
  "Enrichment",
  "Type Coercion",
  "Encoding",
  "String",
  "Timestamp",
  "Networking",
] as const;

export function VrlSnippetDrawer({ onInsert }: VrlSnippetDrawerProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!search.trim()) return VRL_SNIPPETS;
    const q = search.toLowerCase();
    return VRL_SNIPPETS.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q),
    );
  }, [search]);

  const grouped = useMemo(() => {
    const map = new Map<string, VrlSnippet[]>();
    for (const cat of CATEGORIES) {
      const items = filtered.filter((s) => s.category === cat);
      if (items.length > 0) map.set(cat, items);
    }
    return map;
  }, [filtered]);

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="flex h-full w-52 flex-col border-l bg-muted/20">
      <div className="border-b p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search snippets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-1">
          {grouped.size === 0 && (
            <p className="p-3 text-center text-xs text-muted-foreground">
              No snippets found
            </p>
          )}
          {Array.from(grouped.entries()).map(([category, snippets]) => (
            <div key={category}>
              <button
                onClick={() => toggleCategory(category)}
                className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/50"
              >
                {collapsed.has(category) ? (
                  <ChevronRight className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {category}
                <span className="ml-auto text-[10px] font-normal">
                  {snippets.length}
                </span>
              </button>
              {!collapsed.has(category) &&
                snippets.map((snippet) => (
                  <button
                    key={snippet.id}
                    onClick={() => onInsert(snippet.code)}
                    className="group flex w-full flex-col gap-0.5 rounded px-3 py-1.5 text-left hover:bg-accent"
                    title={snippet.code}
                  >
                    <span className="text-xs font-medium">{snippet.name}</span>
                    <span className="line-clamp-1 text-[10px] text-muted-foreground">
                      {snippet.description}
                    </span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/flow/vrl-snippet-drawer.tsx
git commit -m "feat: add VRL snippet drawer component

Categorized, searchable sidebar that inserts VRL snippets on click."
```

---

## Task 9: VRL Snippet Library — Integrate Drawer + Monaco Autocomplete

**Files:**
- Modify: `src/components/vrl-editor/vrl-editor.tsx`
- Modify: `src/components/flow/detail-panel.tsx`

**Step 1: Add snippet insertion and Monaco completions to VRL editor**

In `src/components/vrl-editor/vrl-editor.tsx`:

1. Add imports:
```typescript
import { BookOpen } from "lucide-react";
import { VRL_SNIPPETS } from "@/lib/vrl/snippets";
import { VrlSnippetDrawer } from "@/components/flow/vrl-snippet-drawer";
```

2. Add state for drawer toggle:
```typescript
const [showSnippets, setShowSnippets] = useState(false);
```

3. Add a ref to the Monaco editor instance:
```typescript
const editorRef = useRef<any>(null);
```

4. In `handleEditorMount`, store the editor ref and register completions:
```typescript
const handleEditorMount = useCallback((_editor: unknown, monaco: Monaco) => {
  editorRef.current = _editor;
  monaco.editor.defineTheme("vrl-theme", vrlTheme);
  monaco.editor.setTheme("vrl-theme");

  // Register VRL snippet completions
  monaco.languages.registerCompletionItemProvider("plaintext", {
    provideCompletionItems(model, position) {
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
```

5. Add an `onInsertSnippet` handler:
```typescript
const handleInsertSnippet = useCallback((code: string) => {
  const editor = editorRef.current;
  if (!editor) {
    // Fallback: append to value
    onChange(value ? value + "\n" + code : code);
    return;
  }
  const selection = editor.getSelection();
  const range = selection || editor.getModel()?.getFullModelRange();
  if (range) {
    editor.executeEdits("snippet", [
      { range: { startLineNumber: range.endLineNumber, startColumn: range.endColumn, endLineNumber: range.endLineNumber, endColumn: range.endColumn }, text: "\n" + code },
    ]);
  }
}, [value, onChange]);
```

6. Update the JSX to include a snippet toggle button and the drawer:
```tsx
return (
  <div className="space-y-3">
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => setShowSnippets((p) => !p)}
        title="VRL Snippet Library"
      >
        <BookOpen className="h-3.5 w-3.5" />
      </Button>
    </div>
    <div className="flex overflow-hidden rounded border">
      <div className="flex-1">
        <Editor ... />
      </div>
      {showSnippets && (
        <VrlSnippetDrawer onInsert={handleInsertSnippet} />
      )}
    </div>
    {/* existing test section ... */}
  </div>
);
```

**Step 2: Commit**

```bash
git add src/components/vrl-editor/vrl-editor.tsx src/components/flow/detail-panel.tsx
git commit -m "feat: integrate VRL snippet drawer and Monaco autocomplete

Toggle button opens snippet library alongside the editor. Typing
triggers autocomplete with all 48 VRL snippets."
```

---

## Task 10: Pipeline Metrics — In-Memory Metric Store + Rate Computation

**Files:**
- Create: `src/server/services/metric-store.ts`
- Modify: `src/server/services/fleet-poller.ts`

**Step 1: Create the metric store**

```typescript
// src/server/services/metric-store.ts

export interface MetricSample {
  timestamp: number;
  receivedEventsRate: number;
  sentEventsRate: number;
  receivedBytesRate: number;
  sentBytesRate: number;
  errorCount: number;
}

interface PrevTotals {
  timestamp: number;
  receivedEventsTotal: number;
  sentEventsTotal: number;
  receivedBytesTotal: number;
  sentBytesTotal: number;
}

const MAX_SAMPLES = 240; // 1 hour at 15s intervals

class MetricStore {
  private samples = new Map<string, MetricSample[]>();
  private prevTotals = new Map<string, PrevTotals>();

  /**
   * Compute rates from cumulative totals and store the sample.
   * Key format: "nodeId:componentId"
   */
  recordTotals(
    nodeId: string,
    componentId: string,
    totals: {
      receivedEventsTotal: number;
      sentEventsTotal: number;
      receivedBytesTotal?: number;
      sentBytesTotal?: number;
    },
  ): MetricSample | null {
    const key = `${nodeId}:${componentId}`;
    const now = Date.now();
    const prev = this.prevTotals.get(key);

    this.prevTotals.set(key, {
      timestamp: now,
      receivedEventsTotal: totals.receivedEventsTotal,
      sentEventsTotal: totals.sentEventsTotal,
      receivedBytesTotal: totals.receivedBytesTotal ?? 0,
      sentBytesTotal: totals.sentBytesTotal ?? 0,
    });

    // First sample — no previous data to compute rate
    if (!prev) return null;

    const elapsedSec = (now - prev.timestamp) / 1000;
    if (elapsedSec <= 0) return null;

    const sample: MetricSample = {
      timestamp: now,
      receivedEventsRate: Math.max(0, (totals.receivedEventsTotal - prev.receivedEventsTotal) / elapsedSec),
      sentEventsRate: Math.max(0, (totals.sentEventsTotal - prev.sentEventsTotal) / elapsedSec),
      receivedBytesRate: Math.max(0, ((totals.receivedBytesTotal ?? 0) - prev.receivedBytesTotal) / elapsedSec),
      sentBytesRate: Math.max(0, ((totals.sentBytesTotal ?? 0) - prev.sentBytesTotal) / elapsedSec),
      errorCount: 0,
    };

    const arr = this.samples.get(key) ?? [];
    arr.push(sample);
    if (arr.length > MAX_SAMPLES) arr.shift();
    this.samples.set(key, arr);

    return sample;
  }

  getSamples(nodeId: string, componentId: string, minutes = 60): MetricSample[] {
    const key = `${nodeId}:${componentId}`;
    const arr = this.samples.get(key) ?? [];
    const cutoff = Date.now() - minutes * 60 * 1000;
    return arr.filter((s) => s.timestamp >= cutoff);
  }

  getAllForNode(nodeId: string, minutes = 60): Map<string, MetricSample[]> {
    const result = new Map<string, MetricSample[]>();
    const prefix = `${nodeId}:`;
    const cutoff = Date.now() - minutes * 60 * 1000;
    for (const [key, samples] of this.samples) {
      if (key.startsWith(prefix)) {
        const componentId = key.slice(prefix.length);
        result.set(componentId, samples.filter((s) => s.timestamp >= cutoff));
      }
    }
    return result;
  }
}

// Singleton
const globalForMetrics = globalThis as unknown as { metricStore: MetricStore | undefined };
export const metricStore = globalForMetrics.metricStore ?? new MetricStore();
if (process.env.NODE_ENV !== "production") globalForMetrics.metricStore = metricStore;
```

**Step 2: Integrate metric store into fleet poller**

In `src/server/services/fleet-poller.ts`, import the metric store and feed it during polling:

Add import:
```typescript
import { metricStore } from "./metric-store";
```

In the `pollNode` method, after `const components = await queryComponents(...)`, replace the `this.storeMetrics(...)` call with:

```typescript
// Compute rates and store in metric store
for (const comp of components) {
  metricStore.recordTotals(node.id, comp.componentId, {
    receivedEventsTotal: comp.receivedEventsTotal,
    sentEventsTotal: comp.sentEventsTotal,
    receivedBytesTotal: comp.receivedBytesTotal,
    sentBytesTotal: comp.sentBytesTotal,
  });
}

// Also keep the existing buffer for backwards compat
this.storeMetrics(node.id, components);
```

**Step 3: Commit**

```bash
git add src/server/services/metric-store.ts src/server/services/fleet-poller.ts
git commit -m "feat: add in-memory metric store with rate computation

Ring buffer stores 1 hour of 15s samples per component. Computes
events/sec and bytes/sec from cumulative Vector GraphQL totals."
```

---

## Task 11: Pipeline Metrics — tRPC Router

**Files:**
- Create: `src/server/routers/metrics.ts`
- Modify: `src/trpc/router.ts`

**Step 1: Create the metrics router**

```typescript
// src/server/routers/metrics.ts

import { z } from "zod";
import { router, protectedProcedure } from "@/trpc/init";
import { metricStore } from "@/server/services/metric-store";
import { prisma } from "@/lib/prisma";

export const metricsRouter = router({
  getComponentMetrics: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        componentId: z.string(),
        minutes: z.number().int().min(1).max(60).default(60),
      }),
    )
    .query(({ input }) => {
      return metricStore.getSamples(input.nodeId, input.componentId, input.minutes);
    }),

  getNodeMetrics: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        minutes: z.number().int().min(1).max(60).default(60),
      }),
    )
    .query(({ input }) => {
      const allMetrics = metricStore.getAllForNode(input.nodeId, input.minutes);
      const result: Record<string, { samples: ReturnType<typeof metricStore.getSamples> }> = {};
      for (const [componentId, samples] of allMetrics) {
        result[componentId] = { samples };
      }
      return result;
    }),

  getPipelineMetrics: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        minutes: z.number().int().min(1).max(60).default(60),
      }),
    )
    .query(async ({ input }) => {
      // Find the pipeline's nodes and the Vector nodes they're deployed to
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        include: {
          nodes: true,
          environment: { include: { nodes: true } },
        },
      });

      if (!pipeline) return { components: {} };

      const vectorNodes = pipeline.environment.nodes;
      const componentKeys = pipeline.nodes.map((n) => n.componentKey);

      // Gather metrics from all Vector nodes for this pipeline's components
      const components: Record<string, {
        componentKey: string;
        componentType: string;
        kind: string;
        samples: ReturnType<typeof metricStore.getSamples>;
      }> = {};

      for (const vectorNode of vectorNodes) {
        const nodeMetrics = metricStore.getAllForNode(vectorNode.id, input.minutes);
        for (const [componentId, samples] of nodeMetrics) {
          // Vector componentIds include the pipeline namespace
          const matchingNode = pipeline.nodes.find(
            (pn) => componentId.includes(pn.componentKey),
          );
          if (matchingNode) {
            components[componentId] = {
              componentKey: matchingNode.componentKey,
              componentType: matchingNode.componentType,
              kind: matchingNode.kind,
              samples,
            };
          }
        }
      }

      return { components };
    }),
});
```

**Step 2: Register in the app router**

In `src/trpc/router.ts`, add:

```typescript
import { metricsRouter } from "@/server/routers/metrics";
```

And add to the router object:
```typescript
metrics: metricsRouter,
```

**Step 3: Commit**

```bash
git add src/server/routers/metrics.ts src/trpc/router.ts
git commit -m "feat: add tRPC metrics router for component and pipeline metrics"
```

---

## Task 12: Pipeline Metrics — Install recharts

**Files:**
- Modify: `package.json`

**Step 1: Install recharts**

```bash
pnpm add recharts
```

**Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: add recharts for pipeline metrics charts"
```

---

## Task 13: Pipeline Metrics — Dashboard Page

**Files:**
- Create: `src/app/(dashboard)/pipelines/[id]/metrics/page.tsx`
- Create: `src/components/metrics/summary-cards.tsx`
- Create: `src/components/metrics/component-chart.tsx`

**Step 1: Create summary cards component**

```typescript
// src/components/metrics/summary-cards.tsx
"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { MetricSample } from "@/server/services/metric-store";

interface SummaryCardsProps {
  allSamples: Record<string, { samples: MetricSample[] }>;
}

function avg(samples: MetricSample[], field: keyof MetricSample): number {
  if (samples.length === 0) return 0;
  const sum = samples.reduce((acc, s) => acc + (s[field] as number), 0);
  return sum / samples.length;
}

function latest(samples: MetricSample[], field: keyof MetricSample): number {
  if (samples.length === 0) return 0;
  return samples[samples.length - 1][field] as number;
}

function formatRate(rate: number): string {
  if (rate >= 1000000) return `${(rate / 1000000).toFixed(1)}M/s`;
  if (rate >= 1000) return `${(rate / 1000).toFixed(1)}K/s`;
  return `${Math.round(rate)}/s`;
}

export function SummaryCards({ allSamples }: SummaryCardsProps) {
  const entries = Object.values(allSamples);

  // Aggregate latest rates across all components
  let totalIn = 0;
  let totalOut = 0;
  let totalErrors = 0;

  for (const { samples } of entries) {
    totalIn += latest(samples, "receivedEventsRate");
    totalOut += latest(samples, "sentEventsRate");
    totalErrors += latest(samples, "errorCount");
  }

  const errorRate = totalIn > 0 ? ((totalIn - totalOut) / totalIn) * 100 : 0;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Events In</p>
          <p className="text-2xl font-bold">{formatRate(totalIn)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Events Out</p>
          <p className="text-2xl font-bold">{formatRate(totalOut)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Error Rate</p>
          <p className="text-2xl font-bold">{errorRate.toFixed(1)}%</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Components</p>
          <p className="text-2xl font-bold">{entries.length}</p>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Create component chart**

```typescript
// src/components/metrics/component-chart.tsx
"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { MetricSample } from "@/server/services/metric-store";

interface ComponentChartProps {
  samples: MetricSample[];
  height?: number;
}

export function ComponentChart({ samples, height = 120 }: ComponentChartProps) {
  const data = samples.map((s) => ({
    time: new Date(s.timestamp).toLocaleTimeString(),
    "Events In": Math.round(s.receivedEventsRate),
    "Events Out": Math.round(s.sentEventsRate),
  }));

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        No data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
        <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10 }} width={40} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="Events In"
          stroke="#22c55e"
          fill="#22c55e"
          fillOpacity={0.1}
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="Events Out"
          stroke="#3b82f6"
          fill="#3b82f6"
          fillOpacity={0.1}
          strokeWidth={1.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

**Step 3: Create the dashboard page**

```typescript
// src/app/(dashboard)/pipelines/[id]/metrics/page.tsx
"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryCards } from "@/components/metrics/summary-cards";
import { ComponentChart } from "@/components/metrics/component-chart";

const TIME_RANGES = [
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
] as const;

export default function PipelineMetricsPage() {
  const params = useParams<{ id: string }>();
  const trpc = useTRPC();
  const [minutes, setMinutes] = useState(15);

  const pipelineQuery = useQuery(
    trpc.pipeline.get.queryOptions({ id: params.id }),
  );

  const metricsQuery = useQuery(
    trpc.metrics.getPipelineMetrics.queryOptions(
      { pipelineId: params.id, minutes },
      { refetchInterval: 15000 },
    ),
  );

  if (pipelineQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  const pipeline = pipelineQuery.data;
  const metricsData = metricsQuery.data?.components ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {pipeline?.name ?? "Pipeline"} — Metrics
          </h2>
          <p className="text-muted-foreground">
            Real-time throughput and component performance
          </p>
        </div>
        <div className="flex gap-1">
          {TIME_RANGES.map((tr) => (
            <Button
              key={tr.label}
              variant={minutes === tr.minutes ? "default" : "outline"}
              size="sm"
              onClick={() => setMinutes(tr.minutes)}
            >
              {tr.label}
            </Button>
          ))}
        </div>
      </div>

      <SummaryCards allSamples={metricsData} />

      <Card>
        <CardHeader>
          <CardTitle>Components</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(metricsData).length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
              <p className="text-muted-foreground">
                No metrics data available yet. Metrics appear after the pipeline
                is deployed and the fleet poller begins collecting data.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(metricsData).map(([componentId, data]) => (
                <div key={componentId} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {data.componentKey}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {data.componentType} ({data.kind})
                    </span>
                  </div>
                  <ComponentChart samples={data.samples} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add src/app/\(dashboard\)/pipelines/\[id\]/metrics/ src/components/metrics/
git commit -m "feat: add pipeline metrics dashboard page

Summary cards show aggregate rates. Per-component area charts display
events in/out over time with 5m/15m/1h range selector."
```

---

## Task 14: Pipeline Metrics — Node Sparklines

**Files:**
- Create: `src/components/flow/node-sparkline.tsx`
- Modify: `src/components/flow/source-node.tsx`

**Step 1: Create the sparkline SVG component**

```typescript
// src/components/flow/node-sparkline.tsx
"use client";

import { cn } from "@/lib/utils";
import type { MetricSample } from "@/server/services/metric-store";

interface NodeSparklineProps {
  samples: MetricSample[];
  width?: number;
  height?: number;
}

export function NodeSparkline({
  samples,
  width = 60,
  height = 20,
}: NodeSparklineProps) {
  if (samples.length < 2) return null;

  const rates = samples.map((s) => s.sentEventsRate);
  const max = Math.max(...rates, 1);
  const min = Math.min(...rates, 0);
  const range = max - min || 1;

  const points = rates
    .map((r, i) => {
      const x = (i / (rates.length - 1)) * width;
      const y = height - ((r - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const latest = rates[rates.length - 1];
  const color =
    latest === 0 ? "#ef4444" : latest < 10 ? "#eab308" : "#22c55e";

  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

**Step 2: Integrate sparkline into source-node (and replicate for transform/sink)**

In `src/components/flow/source-node.tsx`, the metrics overlay section (lines 101-113) already renders events/s when `metrics` is present. The existing `NodeMetrics` type can be extended to include sparkline data. However, the actual data flow from the metric store to the React Flow nodes requires the pipeline page to feed metrics into node data.

For now, update the metrics section to also render the sparkline when sample data is provided:

Add import:
```typescript
import { NodeSparkline } from "./node-sparkline";
```

Update the `NodeMetrics` type to include optional samples:
```typescript
type NodeMetrics = {
  eventsPerSec: number;
  status: string;
  samples?: import("@/server/services/metric-store").MetricSample[];
};
```

Update the metrics overlay:
```tsx
{metrics && (
  <div className="flex items-center gap-2 border-t px-3 py-1.5 text-xs">
    <span
      className={cn(
        "h-2 w-2 rounded-full",
        statusColors[metrics.status] ?? "bg-gray-400"
      )}
    />
    <span className="text-muted-foreground">
      {metrics.eventsPerSec} events/s
    </span>
    {metrics.samples && metrics.samples.length > 1 && (
      <NodeSparkline samples={metrics.samples} />
    )}
  </div>
)}
```

Apply the same import + sparkline change to `src/components/flow/transform-node.tsx` and `src/components/flow/sink-node.tsx` if they have the same metrics overlay pattern.

**Step 3: Commit**

```bash
git add src/components/flow/node-sparkline.tsx src/components/flow/source-node.tsx
git commit -m "feat: add inline sparkline component for pipeline flow nodes

SVG polyline sparkline renders events/sec for the last 5 minutes.
Color-coded: green=healthy, yellow=degraded, red=zero throughput."
```

---

## Task 15: Build, Deploy, Verify

**Step 1: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 2: Docker build**

```bash
cd docker && docker compose build vectorflow
```

Expected: Build completes with Vector binary in cached stage.

**Step 3: Deploy**

```bash
cd docker && docker compose up -d --force-recreate vectorflow
```

**Step 4: Verify checklist**

- [ ] App starts without errors
- [ ] SSO login works with Pocket ID (B1)
- [ ] GitOps deploy clones repository without ENOENT (B2)
- [ ] VRL test runs with empty input using default event (B3)
- [ ] Fleet node detail page shows no duplicate host/port (U1)
- [ ] SSH key file picker accepts extensionless files (U2)
- [ ] VRL editor shows snippet toggle button, drawer opens with categories (Task 8-9)
- [ ] Typing `parse` in VRL editor triggers Monaco autocomplete (Task 9)
- [ ] Pipeline metrics page renders at `/pipelines/[id]/metrics` (Task 13)
- [ ] Sparklines render on flow nodes when metrics data is available (Task 14)

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verify build and deployment of bug fixes and features"
```
