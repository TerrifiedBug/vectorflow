# Platform Improvements Round 2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Six quality-of-life improvements: remove built-in templates, pipeline updatedBy tracking, team auth display, richer audit logs, per-environment git credentials, remove target env from templates.

**Architecture:** Single Prisma migration covers all schema changes. Each subsequent task modifies backend routers and frontend pages independently. No new services.

**Tech Stack:** Next.js 15, tRPC, Prisma, PostgreSQL, Zustand, Tailwind, shadcn/ui

---

### Task 1: Database Migration

All schema changes in one migration.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260228170000_platform_improvements_r2/migration.sql`

**Step 1: Update Prisma schema**

In `prisma/schema.prisma`:

Add `updatedById` to Pipeline model (after line 99):
```prisma
model Pipeline {
  id            String            @id @default(cuid())
  name          String
  description   String?
  environmentId String
  environment   Environment       @relation(fields: [environmentId], references: [id])
  nodes         PipelineNode[]
  edges         PipelineEdge[]
  versions      PipelineVersion[]
  isDraft       Boolean           @default(true)
  deployedAt    DateTime?
  updatedById   String?
  updatedBy     User?             @relation("PipelineUpdatedBy", fields: [updatedById], references: [id])
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
}
```

Add `pipelinesUpdated` relation to User model:
```prisma
model User {
  id               String       @id @default(cuid())
  email            String       @unique
  name             String?
  image            String?
  passwordHash     String?
  authMethod       AuthMethod   @default(LOCAL)
  memberships      TeamMember[]
  accounts         Account[]
  auditLogs        AuditLog[]
  pipelinesUpdated Pipeline[]   @relation("PipelineUpdatedBy")
  createdAt        DateTime     @default(now())
}
```

Add IP/user fields to AuditLog model:
```prisma
model AuditLog {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  action     String
  entityType String
  entityId   String
  diff       Json?
  metadata   Json?
  ipAddress  String?
  userEmail  String?
  userName   String?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([userId])
  @@index([createdAt])
}
```

Add git credential fields to Environment model:
```prisma
model Environment {
  id              String       @id @default(cuid())
  name            String
  teamId          String
  team            Team         @relation(fields: [teamId], references: [id])
  nodes           VectorNode[]
  pipelines       Pipeline[]
  gitRepo         String?
  gitBranch       String?
  gitSshKey       Bytes?
  gitHttpsToken   String?
  gitCommitAuthor String?
  createdAt       DateTime     @default(now())
}
```

Remove git credential fields from SystemSettings:
```prisma
model SystemSettings {
  id String @id @default("singleton")

  oidcIssuer       String?
  oidcClientId     String?
  oidcClientSecret String?
  oidcDisplayName  String? @default("SSO")
  oidcDefaultRole  Role    @default(VIEWER)
  oidcGroupsClaim  String? @default("groups")
  oidcAdminGroups  String?
  oidcEditorGroups String?
  oidcTokenEndpointAuthMethod String? @default("client_secret_post")

  fleetPollIntervalMs     Int @default(15000)
  fleetUnhealthyThreshold Int @default(3)

  updatedAt DateTime @updatedAt
}
```

**Step 2: Write the migration SQL**

Create `prisma/migrations/20260228170000_platform_improvements_r2/migration.sql`:
```sql
-- Pipeline: add updatedById
ALTER TABLE "Pipeline" ADD COLUMN "updatedById" TEXT;
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditLog: add IP and denormalized user info
ALTER TABLE "AuditLog" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "userEmail" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "userName" TEXT;

-- Environment: add per-environment git credentials
ALTER TABLE "Environment" ADD COLUMN "gitSshKey" BYTEA;
ALTER TABLE "Environment" ADD COLUMN "gitHttpsToken" TEXT;
ALTER TABLE "Environment" ADD COLUMN "gitCommitAuthor" TEXT;

-- SystemSettings: remove global git credentials
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "gitopsCommitAuthor";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "gitopsSshKey";
ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "gitopsHttpsToken";
```

**Step 3: Regenerate Prisma client**

Run: `npx prisma generate`
Expected: `Generated Prisma Client`

**Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: Type errors in files that reference removed SystemSettings fields (settings.ts, deploy.ts). These will be fixed in subsequent tasks.

**Step 5: Commit**

```bash
git add prisma/
git commit -m "schema: add pipeline updatedBy, richer audit logs, per-env git credentials"
```

---

### Task 2: Remove Built-In Templates

**Files:**
- Delete: `src/lib/vector/builtin-templates.ts`
- Modify: `src/server/routers/template.ts`
- Modify: `src/app/(dashboard)/templates/page.tsx`

**Step 1: Delete the builtin templates file**

Delete `src/lib/vector/builtin-templates.ts` entirely.

**Step 2: Simplify template router**

Rewrite `src/server/routers/template.ts`:
- Remove `import { BUILTIN_TEMPLATES }` (line 5)
- Remove `builtins` procedure entirely (lines 72-82)
- Simplify `list` query to only return custom templates (remove builtin merging, remove `isBuiltin` field)
- Simplify `get` query — remove builtin lookup, only query DB
- Simplify `delete` — remove builtin protection check

The `list` procedure should become:
```typescript
list: protectedProcedure
  .input(z.object({ teamId: z.string() }))
  .query(async ({ input }) => {
    const templates = await prisma.template.findMany({
      where: { teamId: input.teamId },
      orderBy: { createdAt: "desc" },
    });
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      nodeCount: Array.isArray(t.nodes) ? (t.nodes as unknown[]).length : 0,
      edgeCount: Array.isArray(t.edges) ? (t.edges as unknown[]).length : 0,
      createdAt: t.createdAt,
    }));
  }),
```

The `get` procedure should become:
```typescript
get: protectedProcedure
  .input(z.object({ id: z.string() }))
  .query(async ({ input }) => {
    const template = await prisma.template.findUnique({
      where: { id: input.id },
    });
    if (!template) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
    }
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      nodes: template.nodes as unknown[],
      edges: template.edges as unknown[],
    };
  }),
```

The `delete` procedure should remove the builtin check:
```typescript
delete: protectedProcedure
  .use(requireRole("EDITOR"))
  .input(z.object({ id: z.string() }))
  .mutation(async ({ input }) => {
    const existing = await prisma.template.findUnique({
      where: { id: input.id },
    });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
    }
    return prisma.template.delete({ where: { id: input.id } });
  }),
```

**Step 3: Update templates page**

In `src/app/(dashboard)/templates/page.tsx`:
- Remove the "Built-in Templates" section entirely (the grid that shows hardcoded templates)
- Remove the `isBuiltin` conditional rendering
- Show only the user-created templates grid
- Update the `list` query call — `teamId` is now required (not optional)
- Show an empty state when no templates exist: "No templates yet. Save a pipeline as a template to get started."
- Keep the delete button on all templates (no more builtin protection needed in UI)

**Step 4: Verify**

Run: `npx tsc --noEmit` (may still have errors from other tasks — that's fine)

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: remove built-in templates, show only user-created templates"
```

---

### Task 3: Pipeline "Last Updated By"

**Files:**
- Modify: `src/server/routers/pipeline.ts`
- Modify: `src/app/(dashboard)/pipelines/page.tsx`

**Step 1: Update pipeline router**

In `src/server/routers/pipeline.ts`:

Add `updatedById` to the `list` query select (line 38-48):
```typescript
list: protectedProcedure
  .input(z.object({ environmentId: z.string() }))
  .query(async ({ input }) => {
    return prisma.pipeline.findMany({
      where: { environmentId: input.environmentId },
      select: {
        id: true,
        name: true,
        description: true,
        isDraft: true,
        deployedAt: true,
        updatedAt: true,
        updatedBy: { select: { name: true, email: true } },
        _count: { select: { nodes: true, edges: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  }),
```

In the `update` mutation (line 117-131), set `updatedById` from context:
```typescript
.mutation(async ({ input, ctx }) => {
  const { id, ...data } = input;
  const existing = await prisma.pipeline.findUnique({ where: { id } });
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
  }
  return prisma.pipeline.update({
    where: { id },
    data: {
      ...data,
      updatedById: ctx.session.user?.id,
    },
  });
}),
```

In the `saveGraph` mutation (inside the transaction, after the nodes/edges are created), update the pipeline's `updatedById`. Add to the transaction block (after line 208, before the findUniqueOrThrow):
```typescript
await tx.pipeline.update({
  where: { id: input.pipelineId },
  data: { updatedById: ctx.session.user?.id },
});
```

Note: `saveGraph` needs `ctx` — add `ctx` to the destructured params: `async ({ input, ctx }) => {`

**Step 2: Update pipelines list page**

In `src/app/(dashboard)/pipelines/page.tsx`, add "Updated by" info to the table. After the "Last Updated" column, show the user's name or email:

In the table row where `updatedAt` is displayed, add below it:
```tsx
{p.updatedBy && (
  <span className="text-xs text-muted-foreground">
    by {p.updatedBy.name || p.updatedBy.email}
  </span>
)}
```

**Step 3: Verify**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/server/routers/pipeline.ts src/app/\(dashboard\)/pipelines/page.tsx
git commit -m "feat: track and display who last updated each pipeline"
```

---

### Task 4: Team Auth Method Display

**Files:**
- Modify: `src/server/routers/team.ts`
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Step 1: Add authMethod to team.get query**

In `src/server/routers/team.ts`, line 42, add `authMethod` to the user select:
```typescript
include: { user: { select: { id: true, name: true, email: true, image: true, authMethod: true } } },
```

**Step 2: Display auth method badge in settings page**

In `src/app/(dashboard)/settings/page.tsx`, in the team members table, add a badge after the email column showing the auth method. Use a `Badge` component:

- `LOCAL` → Badge variant="outline": "Local"
- `OIDC` → Badge variant="secondary": "SSO"
- `BOTH` → Badge variant="secondary": "SSO + Local"

Find the team members table cell that shows email and add the badge next to it.

**Step 3: Verify**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/server/routers/team.ts src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat: show Local/SSO badge on team members"
```

---

### Task 5: Richer Audit Logs

**Files:**
- Modify: `src/trpc/init.ts`
- Modify: `src/server/services/audit.ts`
- Modify: `src/server/middleware/audit.ts`
- Modify: `src/app/(dashboard)/audit/page.tsx`

**Step 1: Add IP address to tRPC context**

In `src/trpc/init.ts`, import `headers` from Next.js and extract the IP:
```typescript
import { headers } from "next/headers";

export const createContext = async () => {
  const session = await auth();
  let ipAddress: string | null = null;
  try {
    const hdrs = await headers();
    ipAddress = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim()
      || hdrs.get("x-real-ip")
      || null;
  } catch {
    // headers() may fail outside request context
  }
  return { session, ipAddress };
};
```

**Step 2: Update audit service to accept new fields**

In `src/server/services/audit.ts`:
```typescript
export async function writeAuditLog(params: {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  diff?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress?: string | null;
  userEmail?: string | null;
  userName?: string | null;
}) {
  return prisma.auditLog.create({ data: params });
}
```

**Step 3: Update audit middleware to capture IP and user info**

In `src/server/middleware/audit.ts`:
```typescript
export function withAudit(action: string, entityType: string) {
  return middleware(async ({ ctx, next }) => {
    const result = await next();

    if (result.ok) {
      const userId = ctx.session?.user?.id;
      if (userId) {
        const data = result.data as Record<string, any> | undefined;
        const entityId =
          (data && typeof data === "object" && "id" in data
            ? String(data.id)
            : undefined) ?? "unknown";

        writeAuditLog({
          userId,
          action,
          entityType,
          entityId,
          metadata: { timestamp: new Date().toISOString() },
          ipAddress: (ctx as any).ipAddress ?? null,
          userEmail: ctx.session?.user?.email ?? null,
          userName: ctx.session?.user?.name ?? null,
        }).catch(() => {});
      }
    }

    return result;
  });
}
```

**Step 4: Update audit log page to display new fields**

In `src/app/(dashboard)/audit/page.tsx`:
- Add "IP" and "User" columns to the table header
- Show `log.userName || log.userEmail || log.user?.email` in the User column
- Show `log.ipAddress || "—"` in the IP column

**Step 5: Verify**

Run: `npx tsc --noEmit`

**Step 6: Commit**

```bash
git add src/trpc/init.ts src/server/services/audit.ts src/server/middleware/audit.ts src/app/\(dashboard\)/audit/page.tsx
git commit -m "feat: capture IP, email, and username in audit logs"
```

---

### Task 6: Per-Environment Git Credentials

**Files:**
- Modify: `src/server/routers/environment.ts`
- Modify: `src/server/routers/deploy.ts`
- Modify: `src/server/routers/settings.ts`
- Modify: `src/app/(dashboard)/settings/page.tsx`
- Modify: `src/app/(dashboard)/environments/new/page.tsx`
- Modify: `src/app/(dashboard)/environments/[id]/page.tsx`

**Step 1: Add credential endpoints to environment router**

In `src/server/routers/environment.ts`, add two new mutations and update `get`:

Import encrypt/decrypt:
```typescript
import { encrypt, decrypt } from "@/server/services/crypto";
import { createHash } from "crypto";
```

Add to the `get` query return: flags for hasHttpsToken/hasSshKey, fingerprint, commitAuthor:
```typescript
get: protectedProcedure
  .input(z.object({ id: z.string() }))
  .query(async ({ input }) => {
    const environment = await prisma.environment.findUnique({
      where: { id: input.id },
      include: {
        nodes: true,
        _count: { select: { nodes: true, pipelines: true } },
        team: { select: { id: true, name: true } },
      },
    });
    if (!environment) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
    }

    let sshKeyFingerprint: string | null = null;
    if (environment.gitSshKey) {
      try {
        const hash = createHash("sha256").update(environment.gitSshKey).digest("base64");
        sshKeyFingerprint = `SHA256:${hash}`;
      } catch {}
    }

    return {
      ...environment,
      hasSshKey: !!environment.gitSshKey,
      hasHttpsToken: !!environment.gitHttpsToken,
      sshKeyFingerprint,
      gitCommitAuthor: environment.gitCommitAuthor,
      // Never expose raw credentials
      gitSshKey: undefined,
      gitHttpsToken: undefined,
    };
  }),
```

Add `uploadSshKey` mutation:
```typescript
uploadSshKey: protectedProcedure
  .use(requireRole("EDITOR"))
  .input(z.object({ environmentId: z.string(), keyBase64: z.string().min(1) }))
  .mutation(async ({ input }) => {
    const keyBuffer = Buffer.from(input.keyBase64, "base64");
    const keyText = keyBuffer.toString("utf8");
    if (!keyText.includes("PRIVATE KEY")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This does not appear to be a private key. Upload the private key file (not .pub).",
      });
    }
    const encryptedKey = encrypt(keyText);
    return prisma.environment.update({
      where: { id: input.environmentId },
      data: { gitSshKey: Buffer.from(encryptedKey, "utf8") },
    });
  }),
```

Add `updateHttpsToken` mutation:
```typescript
updateHttpsToken: protectedProcedure
  .use(requireRole("EDITOR"))
  .input(z.object({ environmentId: z.string(), token: z.string().min(1) }))
  .mutation(async ({ input }) => {
    const encryptedToken = encrypt(input.token);
    return prisma.environment.update({
      where: { id: input.environmentId },
      data: { gitHttpsToken: encryptedToken },
    });
  }),
```

Add `updateGitCommitAuthor` to the existing `update` input schema:
```typescript
update: protectedProcedure
  .input(z.object({
    id: z.string(),
    name: z.string().min(1).max(100).optional(),
    gitRepo: z.string().nullable().optional(),
    gitBranch: z.string().nullable().optional(),
    gitCommitAuthor: z.string().nullable().optional(),
  }))
```

Also add `requireRole("EDITOR")` import if not already present.

**Step 2: Update deploy router to read credentials from environment**

In `src/server/routers/deploy.ts`, the `gitops` mutation currently reads from SystemSettings. Change it to read from the environment:

Replace the credential loading block (lines 90-134) with:
```typescript
// Load git credentials from the pipeline's environment
const pipeline = await prisma.pipeline.findUnique({
  where: { id: input.pipelineId },
  include: { environment: true },
});
if (!pipeline) {
  throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
}

const { decrypt } = await import("@/server/services/crypto");
const isHttps = input.repoUrl.startsWith("https://");

let sshKey: string | undefined;
if (pipeline.environment.gitSshKey) {
  try {
    sshKey = decrypt(Buffer.from(pipeline.environment.gitSshKey).toString("utf8"));
  } catch (err) {
    console.error("Failed to decrypt SSH key:", err);
  }
}

let httpsToken: string | undefined;
if (pipeline.environment.gitHttpsToken) {
  try {
    httpsToken = decrypt(pipeline.environment.gitHttpsToken);
  } catch (err) {
    console.error("Failed to decrypt HTTPS token:", err);
  }
}

// Validate credentials match the URL scheme
if (isHttps && !httpsToken) {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "HTTPS repository requires a personal access token. Configure one in Environment Settings.",
  });
}
if (!isHttps && !sshKey) {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "SSH repository requires a deploy key. Upload one in Environment Settings.",
  });
}

return deployGitOps(input.pipelineId, input.environmentId, userId, {
  repoUrl: input.repoUrl,
  branch: input.branch,
  commitAuthor: input.commitAuthor || pipeline.environment.gitCommitAuthor || undefined,
  sshKey,
  httpsToken,
});
```

Remove the SystemSettings lookup entirely.

**Step 3: Remove GitOps section from global settings**

In `src/server/routers/settings.ts`:
- Remove `gitopsCommitAuthor`, `sshKeyFingerprint`, `hasSshKey`, `hasHttpsToken` from the `get` response
- Remove `updateGitops` procedure (commit author)
- Remove `uploadSshKey` procedure
- Remove `updateGitopsHttpsToken` procedure
- Remove the `sshKeyFingerprint` helper function if only used for settings

In `src/app/(dashboard)/settings/page.tsx`:
- Remove the entire GitOps tab/section (SSH key upload, HTTPS token input, commit author)
- Remove related state variables and mutations

**Step 4: Add credential management to environment detail page**

In `src/app/(dashboard)/environments/[id]/page.tsx`, add a "Git Credentials" card section:
- SSH Key upload (file input, shows fingerprint if configured)
- HTTPS Token input (password field, shows "Configured" badge if set)
- Commit Author input
- These call the new `environment.uploadSshKey`, `environment.updateHttpsToken`, and `environment.update` mutations

**Step 5: Add credential inputs to environment create page**

In `src/app/(dashboard)/environments/new/page.tsx`:
- Add optional HTTPS Token input field
- Add optional SSH Key file upload
- Add optional Commit Author field
- Note: On create, credentials are uploaded in a follow-up call after the environment is created (since we need the environment ID)

**Step 6: Verify**

Run: `npx tsc --noEmit`

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: move git credentials from global settings to per-environment"
```

---

### Task 7: Remove Target Environment from Templates Page

**Files:**
- Modify: `src/app/(dashboard)/templates/page.tsx`

**Step 1: Replace environment selector with global store**

In `src/app/(dashboard)/templates/page.tsx`:
- Remove the environment `Select` dropdown and its query
- Import `useEnvironmentStore` from `@/stores/environment-store`
- Use `selectedEnvironmentId` from the store when creating a pipeline from a template
- If no environment is selected, show a message: "Select an environment from the header to use templates."

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/app/\(dashboard\)/templates/page.tsx
git commit -m "feat: remove target environment dropdown from templates, use global selector"
```

---

### Task 8: Build, Deploy, Verify

**Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors

**Step 2: Docker build**

Run: `cd docker && docker compose build vectorflow`
Expected: Build succeeds

**Step 3: Deploy**

Run: `cd docker && docker compose up -d --force-recreate vectorflow`
Expected: Container starts, migration runs, app ready

**Step 4: Verify**

- Templates page shows no built-in templates, only user-created
- Pipeline list shows "Updated by" for modified pipelines
- Team members table shows Local/SSO badges
- Audit log shows IP address column
- Environment detail page has SSH key upload and HTTPS token sections
- Global settings page no longer has GitOps credentials section
- Templates page uses global environment selector (no local dropdown)
