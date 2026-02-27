# VectorFlow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build VectorFlow — a full-lifecycle GUI management plane for Vector observability pipelines with visual flow builder, fleet monitoring, config deployment, OIDC + local auth, RBAC, and audit logging.

**Architecture:** Monolithic Next.js 15 app with React Flow for the visual pipeline builder, tRPC for type-safe APIs, Prisma + PostgreSQL for persistence, NextAuth v5 for dual auth (local + OIDC), and a Vector CLI sidecar for config validation and VRL testing. Dockerized for deployment.

**Tech Stack:** Next.js 15, React 19, @xyflow/react 12, tRPC 11, Prisma 6, NextAuth v5 (Auth.js), shadcn/ui, Tailwind CSS 4, Zustand, Monaco Editor, Docker

**Design Doc:** `docs/plans/2026-02-27-vectorflow-design.md`

**Project Location:** `/Users/danny/VSCode/workspace/github/vectorflow`

---

## Phase 1: Project Scaffolding & Foundation

### Task 1: Initialize Next.js project with pnpm

**Files:**
- Create: `vectorflow/package.json`
- Create: `vectorflow/tsconfig.json`
- Create: `vectorflow/next.config.ts`
- Create: `vectorflow/.gitignore`
- Create: `vectorflow/.env.example`

**Step 1: Create the project**

```bash
cd /Users/danny/VSCode/workspace/github
pnpm create next-app@latest vectorflow \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --use-pnpm
```

**Step 2: Verify the project starts**

```bash
cd /Users/danny/VSCode/workspace/github/vectorflow
pnpm dev
# Expected: Next.js dev server starts on http://localhost:3000
```
Press Ctrl+C to stop.

**Step 3: Create .env.example**

Create `vectorflow/.env.example`:
```bash
# Required — bootstrap vars
DATABASE_URL=postgresql://vectorflow:vectorflow@localhost:5432/vectorflow
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=change-me-to-a-random-32-char-string

# Optional — for development
LOG_LEVEL=debug
```

Copy to `.env`:
```bash
cp .env.example .env
```

**Step 4: Update next.config.ts for standalone output**

Edit `vectorflow/next.config.ts`:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
```

**Step 5: Initialize git repo**

```bash
cd /Users/danny/VSCode/workspace/github/vectorflow
git init
git add -A
git commit -m "chore: scaffold Next.js 15 project"
```

---

### Task 2: Install core dependencies

**Step 1: Install production dependencies**

```bash
cd /Users/danny/VSCode/workspace/github/vectorflow
pnpm add @xyflow/react @trpc/server@^11 @trpc/client@^11 @trpc/react-query@^11 \
  @tanstack/react-query@^5 next-auth@beta @auth/prisma-adapter \
  @prisma/client zod superjson zustand next-themes bcryptjs \
  js-yaml @js-yaml/types sonner
```

**Step 2: Install dev dependencies**

```bash
pnpm add -D prisma @types/bcryptjs @types/js-yaml tsx
```

**Step 3: Verify build still works**

```bash
pnpm build
# Expected: Build succeeds
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: install core dependencies"
```

---

### Task 3: Set up shadcn/ui with dark/light theme

**Files:**
- Modify: `src/app/globals.css`
- Create: `src/components/theme-provider.tsx`
- Modify: `src/app/layout.tsx`
- Create: `components.json`

**Step 1: Initialize shadcn/ui**

```bash
cd /Users/danny/VSCode/workspace/github/vectorflow
pnpm dlx shadcn@latest init -y --base-color neutral
```

**Step 2: Add core UI components**

```bash
pnpm dlx shadcn@latest add button card dialog dropdown-menu input label \
  separator sheet tabs form select badge avatar command popover \
  table tooltip sidebar scroll-area switch textarea
pnpm add sonner
pnpm dlx shadcn@latest add sonner
```

**Step 3: Create theme provider**

Create `src/components/theme-provider.tsx`:
```typescript
"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

**Step 4: Create theme toggle component**

Create `src/components/theme-toggle.tsx`:
```typescript
"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
```

**Step 5: Add custom VectorFlow CSS variables for node colors**

Append to `src/app/globals.css` (after the existing shadcn variables):
```css
:root {
  --node-source: oklch(0.65 0.18 145);
  --node-transform: oklch(0.60 0.15 250);
  --node-sink: oklch(0.55 0.20 295);
  --node-source-foreground: oklch(0.98 0 0);
  --node-transform-foreground: oklch(0.98 0 0);
  --node-sink-foreground: oklch(0.98 0 0);
}

.dark {
  --node-source: oklch(0.50 0.15 145);
  --node-transform: oklch(0.45 0.12 250);
  --node-sink: oklch(0.40 0.17 295);
}

@theme inline {
  --color-node-source: var(--node-source);
  --color-node-transform: var(--node-transform);
  --color-node-sink: var(--node-sink);
  --color-node-source-foreground: var(--node-source-foreground);
  --color-node-transform-foreground: var(--node-transform-foreground);
  --color-node-sink-foreground: var(--node-sink-foreground);
}
```

**Step 6: Update root layout with theme provider**

Edit `src/app/layout.tsx`:
```typescript
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VectorFlow",
  description: "Visual pipeline management for Vector",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

**Step 7: Verify theme switching works**

```bash
pnpm dev
# Visit http://localhost:3000, inspect that dark/light classes toggle correctly
```

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: set up shadcn/ui with dark/light theme"
```

---

### Task 4: Set up Prisma with PostgreSQL

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/prisma.ts`

**Step 1: Initialize Prisma**

```bash
cd /Users/danny/VSCode/workspace/github/vectorflow
npx prisma init
```

**Step 2: Write the full Prisma schema**

Replace `prisma/schema.prisma` with the full schema from the design doc (all models: User, Team, TeamMember, Environment, VectorNode, Pipeline, PipelineNode, PipelineEdge, PipelineVersion, Template, AuditLog, SystemSettings). See design doc section "Prisma Schema" for the complete schema.

**Step 3: Create Prisma singleton**

Create `src/lib/prisma.ts`:
```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

**Step 4: Start a local PostgreSQL (docker)**

```bash
docker run -d --name vectorflow-postgres \
  -e POSTGRES_USER=vectorflow \
  -e POSTGRES_PASSWORD=vectorflow \
  -e POSTGRES_DB=vectorflow \
  -p 5432:5432 \
  postgres:16-alpine
```

**Step 5: Run initial migration**

```bash
npx prisma migrate dev --name init
# Expected: Migration applied, Prisma Client generated
```

**Step 6: Verify with Prisma Studio**

```bash
npx prisma studio
# Expected: Opens browser at http://localhost:5555 showing all tables
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: set up Prisma schema with all data models"
```

---

### Task 5: Set up tRPC with Next.js App Router

**Files:**
- Create: `src/trpc/init.ts`
- Create: `src/trpc/router.ts`
- Create: `src/trpc/client.tsx`
- Create: `src/app/api/trpc/[trpc]/route.ts`
- Modify: `src/app/layout.tsx`

**Step 1: Create tRPC initialization**

Create `src/trpc/init.ts`:
```typescript
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { auth } from "@/auth";
import type { Role } from "@prisma/client";

export const createContext = async () => {
  const session = await auth();
  return { session };
};

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { session: ctx.session },
  });
});

const roleLevel: Record<Role, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2,
};

export const requireRole = (minRole: Role) =>
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    // Role check will be implemented once team context is added
    return next({ ctx: { session: ctx.session } });
  });
```

Note: The `auth` import will be created in Task 6. Create a stub for now.

**Step 2: Create the app router**

Create `src/trpc/router.ts`:
```typescript
import { router } from "./init";

export const appRouter = router({
  // Routers will be added per phase
});

export type AppRouter = typeof appRouter;
```

**Step 3: Create the API route handler**

Create `src/app/api/trpc/[trpc]/route.ts`:
```typescript
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/trpc/router";
import { createContext } from "@/trpc/init";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
  });

export { handler as GET, handler as POST };
```

**Step 4: Create client-side tRPC provider**

Create `src/trpc/client.tsx`:
```typescript
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchStreamLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState } from "react";
import superjson from "superjson";
import type { AppRouter } from "./router";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function TRPCClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5 * 1000 },
        },
      })
  );

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        httpBatchStreamLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      ],
    })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider client={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
```

**Step 5: Wrap the root layout with providers**

Update `src/app/layout.tsx` to include the tRPC provider (wrap children with `<TRPCClientProvider>`).

**Step 6: Verify build compiles**

```bash
pnpm build
# May have TypeScript errors from the missing auth stub — that's OK, we'll fix in Task 6
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: set up tRPC v11 with Next.js App Router"
```

---

### Task 6: Set up NextAuth v5 with local credentials

**Files:**
- Create: `src/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/middleware.ts`

**Step 1: Create auth configuration**

Create `src/auth.ts`:
```typescript
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!valid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
    // OIDC provider will be added dynamically from SystemSettings
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
```

**Step 2: Create the NextAuth route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:
```typescript
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

**Step 3: Create middleware for auth protection**

Create `src/middleware.ts`:
```typescript
export { auth as middleware } from "@/auth";

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|login|setup).*)",
  ],
};
```

**Step 4: Create NextAuth type augmentation**

Create `src/types/next-auth.d.ts`:
```typescript
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
```

**Step 5: Verify auth compiles**

```bash
pnpm build
# Expected: Build succeeds (might warn about unused imports, that's fine)
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: set up NextAuth v5 with local credentials"
```

---

### Task 7: Create setup wizard and login page

**Files:**
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/setup/page.tsx`
- Create: `src/app/(auth)/layout.tsx`
- Create: `src/server/services/setup.ts`

**Step 1: Create auth layout (centered card)**

Create `src/app/(auth)/layout.tsx` — a minimal centered layout for login/setup pages.

**Step 2: Create login page**

Create `src/app/(auth)/login/page.tsx`:
- Email + password form using shadcn form components
- "Sign in with SSO" button (conditionally shown if OIDC configured)
- Link to `/setup` if no users exist (first run detection)
- Uses `signIn("credentials", { email, password })` from next-auth

**Step 3: Create setup wizard**

Create `src/app/(auth)/setup/page.tsx`:
- Step 1: Create admin account (email, name, password, confirm password)
- Step 2: Create first team (team name)
- Server action that creates User (with bcrypt-hashed password, role ADMIN), Team, and TeamMember
- Redirects to `/login` after setup
- Only accessible when no users exist (checked server-side)

**Step 4: Create setup service**

Create `src/server/services/setup.ts`:
```typescript
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function isSetupRequired(): Promise<boolean> {
  const userCount = await prisma.user.count();
  return userCount === 0;
}

export async function completeSetup(input: {
  email: string;
  name: string;
  password: string;
  teamName: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        authMethod: "LOCAL",
      },
    });

    const team = await tx.team.create({
      data: { name: input.teamName },
    });

    await tx.teamMember.create({
      data: {
        userId: user.id,
        teamId: team.id,
        role: "ADMIN",
      },
    });

    await tx.systemSettings.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    });

    return { user, team };
  });
}
```

**Step 5: Test the full setup → login flow manually**

```bash
pnpm dev
# 1. Visit http://localhost:3000 → should redirect to /login
# 2. Visit http://localhost:3000/setup → create admin account
# 3. Visit http://localhost:3000/login → log in with created credentials
# 4. Should redirect to / (dashboard, will be a blank page for now)
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add setup wizard and login page with local auth"
```

---

## Phase 2: Dashboard Shell & Navigation

### Task 8: Create dashboard layout with sidebar navigation

**Files:**
- Create: `src/app/(dashboard)/layout.tsx`
- Create: `src/components/app-sidebar.tsx`
- Create: `src/app/(dashboard)/page.tsx`

**Step 1: Create the dashboard layout**

Uses the shadcn sidebar component. Left sidebar with navigation links:
- Dashboard (home icon)
- Pipelines (workflow icon)
- Fleet (server icon)
- Environments (layers icon)
- Templates (file-text icon)
- Audit Log (scroll-text icon)
- Settings (settings icon, only shown for ADMIN role)

Top bar with: current team name, theme toggle, user avatar dropdown (profile, sign out).

**Step 2: Create a placeholder dashboard page**

`src/app/(dashboard)/page.tsx` — shows "Welcome to VectorFlow" with quick stats cards (placeholder data: 0 pipelines, 0 nodes, 0 environments).

**Step 3: Verify navigation works**

```bash
pnpm dev
# Login → should see dashboard with sidebar, all nav links present
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add dashboard layout with sidebar navigation"
```

---

## Phase 3: Core Data Management (Teams, Environments, Fleet)

### Task 9: Create tRPC routers for teams and environments

**Files:**
- Create: `src/server/routers/team.ts`
- Create: `src/server/routers/environment.ts`
- Modify: `src/trpc/router.ts`

Implement CRUD operations for teams and environments with role-based access via tRPC middleware. Environments include `deployMode`, optional Git config fields.

**Commit:** `feat: add team and environment tRPC routers`

---

### Task 10: Create environments management page

**Files:**
- Create: `src/app/(dashboard)/environments/page.tsx`
- Create: `src/app/(dashboard)/environments/new/page.tsx`

Environment list page with table (name, deploy mode, node count, created date). "New Environment" dialog/page with form fields: name, deploy mode (API Reload / GitOps), git repo + branch (conditional on GitOps mode).

**Commit:** `feat: add environments management page`

---

### Task 11: Create fleet management router and pages

**Files:**
- Create: `src/server/routers/fleet.ts`
- Create: `src/app/(dashboard)/fleet/page.tsx`
- Create: `src/app/(dashboard)/fleet/[nodeId]/page.tsx`

Fleet router: CRUD for VectorNode (add/remove/update nodes in an environment). Fleet list page with health status badges. Single node detail page (placeholder for live metrics — will be wired up in Phase 6).

**Commit:** `feat: add fleet management router and pages`

---

## Phase 4: Flow Builder (Core Feature)

### Task 12: Create Vector component catalog

**Files:**
- Create: `src/lib/vector/catalog.ts`
- Create: `src/lib/vector/types.ts`

This is the static catalog of all Vector components with their metadata. Each entry defines: component type, kind (source/transform/sink), display name, description, category, input data types, output data types, and a JSON Schema for its config fields.

`src/lib/vector/types.ts`:
```typescript
export type DataType = "log" | "metric" | "trace";

export interface VectorComponentDef {
  type: string;               // e.g. "kafka", "remap", "elasticsearch"
  kind: "source" | "transform" | "sink";
  displayName: string;
  description: string;
  category: string;           // e.g. "Messaging", "Cloud", "Observability"
  inputTypes?: DataType[];    // What data types this accepts (transforms/sinks)
  outputTypes: DataType[];    // What data types this emits (sources/transforms)
  configSchema: object;       // JSON Schema for the config form
  icon?: string;              // Lucide icon name
}
```

`src/lib/vector/catalog.ts` — export a `VECTOR_CATALOG: VectorComponentDef[]` array. Start with ~20 most common components (file, kafka, syslog, http_server, demo_logs for sources; remap, filter, route, sample, dedupe for transforms; elasticsearch, aws_s3, console, datadog_logs, loki, http for sinks). Each with a basic JSON Schema for their key config fields. More can be added iteratively.

**Commit:** `feat: add Vector component catalog with type definitions`

---

### Task 13: Create pipeline tRPC router

**Files:**
- Create: `src/server/routers/pipeline.ts`
- Modify: `src/trpc/router.ts`

CRUD operations for pipelines, pipeline nodes, and pipeline edges. Key procedures:
- `pipeline.list` — list pipelines for an environment
- `pipeline.get` — get pipeline with nodes and edges
- `pipeline.create` — create new pipeline
- `pipeline.update` — update pipeline name/description
- `pipeline.delete` — delete pipeline
- `pipeline.saveGraph` — save nodes + edges (batch upsert)

**Commit:** `feat: add pipeline tRPC router`

---

### Task 14: Create React Flow store with Zustand

**Files:**
- Create: `src/stores/flow-store.ts`

Zustand store that manages:
- `nodes: Node[]` — React Flow nodes
- `edges: Edge[]` — React Flow edges
- `selectedNodeId: string | null`
- `onNodesChange`, `onEdgesChange`, `onConnect` — React Flow callbacks
- `addNode(componentDef, position)` — add a new component to canvas
- `removeNode(id)` — remove node and its connected edges
- `updateNodeConfig(id, config)` — update a node's component config
- `undo()` / `redo()` — snapshot-based undo/redo using Zundo middleware
- `toVectorConfig()` — serialize current graph to Vector YAML
- `fromVectorConfig(yaml)` — parse Vector config into graph

**Commit:** `feat: add Zustand flow store with undo/redo`

---

### Task 15: Create custom React Flow nodes

**Files:**
- Create: `src/components/flow/source-node.tsx`
- Create: `src/components/flow/transform-node.tsx`
- Create: `src/components/flow/sink-node.tsx`
- Create: `src/components/flow/node-types.ts`

Each custom node:
- Color-coded header bar (source=green, transform=blue, sink=purple using CSS vars)
- Icon + component type name
- Component key (user-defined name) shown below
- Brief config summary (e.g., "topic: app-logs" for kafka)
- Input handle(s) on left (transforms, sinks)
- Output handle(s) on right (sources, transforms)
- Data type badges on handles (Log/Metric/Trace)
- Selected state with highlight ring

Use `isValidConnection` on ReactFlow component to enforce DataType compatibility.

**Commit:** `feat: add custom React Flow nodes with DataType validation`

---

### Task 16: Create component palette (left panel)

**Files:**
- Create: `src/components/flow/component-palette.tsx`

Collapsible left panel with:
- Search input to filter components
- Three sections: Sources, Transforms, Sinks
- Each component as a draggable item (using HTML5 drag and drop)
- Shows icon + name + brief description
- Drag data includes the component type for creating a node on drop

The flow canvas handles `onDrop` to create a new node at the drop position.

**Commit:** `feat: add component palette with drag-to-canvas`

---

### Task 17: Create detail panel (right panel) with schema-driven forms

**Files:**
- Create: `src/components/flow/detail-panel.tsx`
- Create: `src/components/config-forms/schema-form.tsx`
- Create: `src/components/config-forms/field-renderer.tsx`

Detail panel opens when a node is selected:
- Component key input (editable, validates uniqueness)
- Component type (read-only)
- Auto-generated config form based on the component's JSON Schema
- Schema form recursively renders fields based on type:
  - `string` → text input
  - `number` → number input
  - `boolean` → switch/checkbox
  - `array` of strings → tag input
  - `object` → nested fieldset
  - `enum` → select dropdown
- Changes update the Zustand store immediately

**Commit:** `feat: add detail panel with schema-driven config forms`

---

### Task 18: Create the pipeline builder page

**Files:**
- Create: `src/app/(dashboard)/pipelines/page.tsx`
- Create: `src/app/(dashboard)/pipelines/new/page.tsx`
- Create: `src/app/(dashboard)/pipelines/[id]/page.tsx`
- Create: `src/components/flow/flow-canvas.tsx`
- Create: `src/components/flow/flow-toolbar.tsx`

Pipeline list page: table of pipelines with name, environment, status (draft/deployed), last updated.

Pipeline builder page (`/pipelines/[id]`):
- Loads pipeline from tRPC
- Three-panel layout: palette | canvas | detail panel
- Toolbar: Save, Validate, Deploy dropdown, Import, Export (YAML/TOML), Undo, Redo
- Auto-save on Cmd+S
- React Flow canvas with minimap and controls

**Commit:** `feat: add pipeline builder page with flow canvas`

---

## Phase 5: Config Generation & Validation

### Task 19: Create config generator (graph → YAML/TOML)

**Files:**
- Create: `src/lib/config-generator/index.ts`
- Create: `src/lib/config-generator/yaml-generator.ts`
- Create: `src/lib/config-generator/toml-generator.ts`

Walk the React Flow graph and produce valid Vector config:
1. Group nodes by kind (sources, transforms, sinks)
2. For each node, use its `componentKey` as the YAML key under the appropriate section
3. Set `type` from `componentType`
4. For transforms and sinks, build `inputs` array from incoming edges
5. Merge the node's config object
6. Serialize to YAML using `js-yaml`
7. Optionally serialize to TOML

Include unit tests that verify a known graph produces the expected YAML output.

**Commit:** `feat: add config generator (graph to YAML/TOML)`

---

### Task 20: Create config importer (YAML/TOML → graph)

**Files:**
- Create: `src/lib/config-generator/importer.ts`

Parse a Vector YAML/TOML config and produce React Flow nodes + edges:
1. Parse YAML into object
2. Extract sources, transforms, sinks sections
3. Create PipelineNode for each component (with auto-generated positions using dagre layout)
4. Read `inputs` fields to create edges
5. Return `{ nodes, edges }` for the Zustand store

Add dagre as a dependency for auto-layout:
```bash
pnpm add @dagrejs/dagre
```

Include unit tests with sample Vector configs.

**Commit:** `feat: add config importer (YAML/TOML to graph)`

---

### Task 21: Add import/export UI to flow toolbar

**Files:**
- Modify: `src/components/flow/flow-toolbar.tsx`

- Export button: dropdown with "Download YAML" and "Download TOML" options
  - Calls `toVectorConfig()` from the store, triggers file download
- Import button: opens file picker for .yaml/.yml/.toml files
  - Parses file content, calls importer, loads result into store
- Validate button: calls the validation endpoint (Task 22)
  - Shows success toast or error dialog with per-node error mapping

**Commit:** `feat: add import/export and validation to flow toolbar`

---

### Task 22: Create validation service (Vector CLI)

**Files:**
- Create: `src/server/services/validator.ts`
- Create: `src/server/routers/validator.ts`

Server-side validation using `vector validate`:
1. Write generated YAML to a temp file
2. Shell out to `vector validate --config-yaml <path>` (requires `vector` binary in PATH or Docker)
3. Parse stdout/stderr for validation results
4. Map errors back to component keys
5. Return structured result

tRPC router exposes `validator.validate` mutation.

For development environments where `vector` isn't installed, provide a fallback that does basic structural validation (check that sources exist, sinks have inputs, etc.).

**Commit:** `feat: add config validation via Vector CLI`

---

## Phase 6: Fleet Monitoring

### Task 23: Create Vector GraphQL client

**Files:**
- Create: `src/server/integrations/vector-graphql.ts`

GraphQL client that queries a Vector node's API:
- `queryComponents(host, port)` — returns component list with metrics
- `queryHealth(host, port)` — basic health check (is API responsive?)
- Uses native `fetch` with GraphQL queries (no heavy client library needed)

**Commit:** `feat: add Vector GraphQL client for fleet polling`

---

### Task 24: Create fleet polling service

**Files:**
- Create: `src/server/services/fleet-poller.ts`

Background polling service:
- On app startup, starts polling all nodes across all environments
- Reads `fleetPollIntervalMs` from SystemSettings
- For each node: query health + metrics via GraphQL client
- Update `VectorNode.status` and `lastSeen` in database
- Track consecutive failures to determine UNREACHABLE threshold
- Store recent metrics in memory (1 hour window)

This runs as a singleton in the Next.js server process.

**Commit:** `feat: add fleet polling background service`

---

### Task 25: Create SSE endpoint for real-time fleet updates

**Files:**
- Create: `src/app/api/fleet/events/route.ts`
- Create: `src/hooks/use-fleet-events.ts`

SSE endpoint that streams fleet status changes to the browser:
- Server: `GET /api/fleet/events` returns `text/event-stream`
- Client: `useFleetEvents()` hook connects to SSE, updates local state
- Events: `node:status` (health change), `node:metrics` (throughput update)

**Commit:** `feat: add SSE endpoint for real-time fleet updates`

---

### Task 26: Add monitoring overlay to flow builder

**Files:**
- Modify: `src/components/flow/source-node.tsx`
- Modify: `src/components/flow/transform-node.tsx`
- Modify: `src/components/flow/sink-node.tsx`
- Create: `src/components/flow/metric-edge.tsx`

When viewing a deployed pipeline in an environment with live nodes:
- Nodes show health badge (healthy/degraded across fleet)
- Nodes show aggregate metrics (events/s)
- Custom edge component shows throughput label
- Toggle between "edit mode" and "monitor mode" in toolbar

**Commit:** `feat: add monitoring overlay to flow builder`

---

## Phase 7: Config Deployment & Versioning

### Task 27: Create pipeline version service

**Files:**
- Create: `src/server/services/pipeline-version.ts`
- Modify: `src/server/routers/pipeline.ts`

Service for managing pipeline versions:
- `createVersion(pipelineId, configYaml, userId, changelog)` — creates immutable snapshot
- `listVersions(pipelineId)` — ordered by version number
- `getVersion(versionId)` — get single version with full config
- `rollback(pipelineId, targetVersionId)` — creates new version copying target's config

tRPC endpoints: `pipeline.versions`, `pipeline.createVersion`, `pipeline.rollback`

**Commit:** `feat: add pipeline versioning with rollback`

---

### Task 28: Create deployment service (API reload)

**Files:**
- Create: `src/server/services/deploy.ts`

API reload deployment:
1. Generate YAML config from pipeline
2. Validate config
3. For each node in the environment: POST config to Vector's reload endpoint
4. Verify health after reload
5. Create pipeline version snapshot
6. Write audit log entry
7. Return deployment result (success/failure per node)

**Commit:** `feat: add API reload deployment service`

---

### Task 29: Create deployment service (GitOps)

**Files:**
- Create: `src/server/services/deploy-gitops.ts`
- Create: `src/server/integrations/git-client.ts`

GitOps deployment:
1. Generate YAML config from pipeline
2. Validate config
3. Clone/pull the configured Git repo (using SSH key from SystemSettings)
4. Write YAML to the configured path
5. Commit with message including pipeline name, version, user
6. Push to configured branch
7. Create pipeline version snapshot
8. Write audit log entry

Git client uses `simple-git` npm package:
```bash
pnpm add simple-git
```

**Commit:** `feat: add GitOps deployment service`

---

### Task 30: Create deploy wizard UI

**Files:**
- Create: `src/app/(dashboard)/pipelines/[id]/deploy/page.tsx`
- Create: `src/components/deploy/diff-viewer.tsx`
- Create: `src/components/deploy/deploy-status.tsx`

Deploy wizard flow:
1. Show validation result (pass/fail)
2. Show config diff (current deployed vs new) using a side-by-side diff component
3. Environment selector + deploy strategy indicator
4. "Deploy to Fleet" / "Push to Git" button
5. Real-time deployment status (per-node results)
6. Success/failure summary

**Commit:** `feat: add deploy wizard with diff viewer`

---

### Task 31: Create version history page

**Files:**
- Create: `src/app/(dashboard)/pipelines/[id]/versions/page.tsx`

Version history:
- Table of versions: version number, created by, timestamp, changelog
- Click to view full config YAML
- Diff button to compare any two versions
- Rollback button (creates new version, triggers deploy)
- Currently deployed version highlighted

**Commit:** `feat: add pipeline version history page`

---

## Phase 8: Audit Logging

### Task 32: Create audit logging middleware

**Files:**
- Create: `src/server/services/audit.ts`
- Create: `src/server/middleware/audit.ts`

tRPC middleware that wraps mutations:
- Captures entity state before the mutation
- Runs the mutation
- Captures entity state after the mutation
- Computes diff (before/after JSON)
- Writes AuditLog entry with user, action, entity, diff, metadata (IP, user agent)

Factory function: `withAudit(action: string, entityType: string)` returns tRPC middleware.

Apply to key mutations: pipeline CRUD, deploy, rollback, environment CRUD, node CRUD, settings changes.

**Commit:** `feat: add audit logging tRPC middleware`

---

### Task 33: Create audit log viewer page

**Files:**
- Create: `src/server/routers/audit.ts`
- Create: `src/app/(dashboard)/audit/page.tsx`

tRPC router: `audit.list` with filters (action, userId, entityType, dateRange, search).

Page:
- Table with columns: timestamp, user, action, entity, details
- Filter bar: action type dropdown, user dropdown, date range picker
- Click row to expand: shows full diff + metadata
- Pagination

**Commit:** `feat: add audit log viewer page`

---

## Phase 9: Admin Settings

### Task 34: Create settings router and encryption service

**Files:**
- Create: `src/server/services/crypto.ts`
- Create: `src/server/routers/settings.ts`

Encryption service:
- `encrypt(plaintext)` / `decrypt(ciphertext)` using AES-256-GCM
- Key derived from `NEXTAUTH_SECRET` via HKDF
- Used for OIDC client secret and SSH key storage

Settings router (ADMIN only):
- `settings.get` — returns current settings (secrets masked)
- `settings.updateOidc` — save OIDC config (encrypts secret)
- `settings.updateFleet` — save fleet polling config
- `settings.updateGitops` — save GitOps config
- `settings.uploadSshKey` — upload SSH key file (encrypts and stores)
- `settings.testOidc` — test OIDC provider connectivity

**Commit:** `feat: add settings router with encryption`

---

### Task 35: Create admin settings pages

**Files:**
- Create: `src/app/(dashboard)/settings/page.tsx`
- Create: `src/app/(dashboard)/settings/auth/page.tsx`
- Create: `src/app/(dashboard)/settings/fleet/page.tsx`
- Create: `src/app/(dashboard)/settings/gitops/page.tsx`
- Create: `src/app/(dashboard)/settings/team/page.tsx`

Settings page with sidebar tabs:
- **Auth:** OIDC issuer, client ID, client secret (masked), display name, test connection button
- **Fleet:** Poll interval (seconds), unhealthy threshold (missed polls)
- **GitOps:** Commit author, SSH key upload/remove/download-public, key fingerprint display
- **Team:** Member list table, invite member form, role dropdown per member, remove member

All forms save via tRPC mutations with success toasts.

**Commit:** `feat: add admin settings pages`

---

### Task 36: Wire up dynamic OIDC provider from SystemSettings

**Files:**
- Modify: `src/auth.ts`

Update NextAuth config to dynamically load OIDC provider from SystemSettings:
1. On auth initialization, query SystemSettings for OIDC config
2. If configured, add OIDC provider to the providers array
3. Decrypt client secret using crypto service
4. Login page conditionally shows SSO button

For hot-reload: expose a function that rebuilds the NextAuth config when OIDC settings change.

**Commit:** `feat: wire up dynamic OIDC provider from settings`

---

## Phase 10: VRL Playground & Templates

### Task 37: Create VRL editor component

**Files:**
- Create: `src/components/vrl-editor/vrl-editor.tsx`
- Create: `src/components/vrl-editor/vrl-theme.ts`
- Create: `src/server/routers/vrl.ts`

Install Monaco:
```bash
pnpm add @monaco-editor/react
```

VRL editor component:
- Monaco editor with custom VRL syntax highlighting theme
- "Test" button with sample input textarea
- Output display (JSON formatted)
- Error display with line highlighting

tRPC router: `vrl.test` mutation
- Takes `{ source: string, input: string }`
- Writes to temp files
- Shells out to `vector vrl --input <path> --program <path>`
- Returns `{ output: string, error?: string, durationMs: number }`
- Falls back to a "VRL testing requires vector binary" message if not available

**Commit:** `feat: add VRL playground editor with test runner`

---

### Task 38: Integrate VRL editor into detail panel

**Files:**
- Modify: `src/components/flow/detail-panel.tsx`

When a `remap` transform is selected, replace the `source` config field with the VRL editor component. Also use VRL editor for:
- `filter` transform → `condition` field
- `route` transform → per-route `condition` fields

**Commit:** `feat: integrate VRL editor into transform detail panel`

---

### Task 39: Create template system

**Files:**
- Create: `src/server/routers/template.ts`
- Create: `src/lib/vector/builtin-templates.ts`
- Create: `src/app/(dashboard)/templates/page.tsx`

Template router: CRUD for templates, scoped to team. Plus `template.builtins` for built-in templates.

Built-in templates (5-8 common patterns):
1. **Demo → Console** (Getting Started): demo_logs → console
2. **File → Elasticsearch** (Logging): file → remap (parse JSON) → elasticsearch
3. **Syslog → S3** (Archival): syslog → remap → aws_s3
4. **Kafka → Elasticsearch** (Streaming): kafka → remap → filter → elasticsearch
5. **Host Metrics → Datadog** (Metrics): host_metrics → datadog_metrics

Each template defined as `{ nodes: PipelineNode[], edges: PipelineEdge[] }`.

Templates page:
- Built-in templates section (cards with name, description, visual preview)
- Team templates section (with edit/delete for EDITOR+)
- "Use Template" button → creates new pipeline draft from template
- "Save as Template" button on pipeline builder toolbar

**Commit:** `feat: add pipeline template system with built-in templates`

---

## Phase 11: Docker & Production Deployment

### Task 40: Create Docker configuration

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/docker-compose.yml`
- Create: `docker/entrypoint.sh`
- Create: `docker/.env.example`

Multi-stage Dockerfile:
- Stage 1: `node:22-alpine` — install dependencies with pnpm
- Stage 2: `node:22-alpine` — build Next.js (standalone output)
- Stage 3: `node:22-alpine` — production runtime (copy standalone + static + prisma)
- Non-root user `vectorflow` (uid 1001)
- Entrypoint: run `prisma migrate deploy` then `node server.js`

docker-compose.yml: vectorflow + postgres services (as defined in design doc).

**Step: Test Docker build**

```bash
cd /Users/danny/VSCode/workspace/github/vectorflow
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up -d
# Visit http://localhost:3000 → should see setup wizard
```

**Commit:** `feat: add Docker and docker-compose configuration`

---

### Task 41: Create health check endpoint

**Files:**
- Create: `src/app/api/health/route.ts`

Simple health endpoint:
```typescript
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "connected" });
  } catch {
    return Response.json({ status: "error", db: "disconnected" }, { status: 503 });
  }
}
```

**Commit:** `feat: add health check endpoint`

---

## Phase 12: Polish & Integration Testing

### Task 42: Add keyboard shortcuts

**Files:**
- Create: `src/hooks/use-keyboard-shortcuts.ts`
- Modify: `src/components/flow/flow-canvas.tsx`

Global shortcuts in the flow builder:
- `Cmd+S` → save pipeline
- `Cmd+Z` → undo
- `Cmd+Shift+Z` → redo
- `Delete` / `Backspace` → delete selected node/edge
- `Cmd+E` → export YAML
- `Cmd+I` → import config

**Commit:** `feat: add keyboard shortcuts to flow builder`

---

### Task 43: Add dashboard home page with real data

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`
- Create: `src/server/routers/dashboard.ts`

Dashboard shows:
- Fleet health summary (N healthy, N degraded, N unreachable)
- Recent pipelines (last 5 modified)
- Recent audit log entries (last 10)
- Quick actions (new pipeline, add node)

All powered by real tRPC queries.

**Commit:** `feat: add dashboard home page with real data`

---

### Task 44: End-to-end integration test

**Step 1:** Start the full stack with Docker Compose
**Step 2:** Run through the complete workflow manually:
1. First-run setup → create admin
2. Login with local credentials
3. Create environment (dev)
4. Add a Vector node to the environment
5. Create pipeline from template (Demo → Console)
6. Modify pipeline in flow builder (add a filter transform)
7. Validate the pipeline
8. Export as YAML → verify it's valid Vector config
9. Import an existing Vector config → verify it renders correctly
10. Check audit log → verify all actions are logged
11. Test dark/light theme toggle
12. Test RBAC (create viewer user, verify read-only access)

**Step 3:** Fix any issues found

**Commit:** `fix: integration test fixes`

---

## Summary: Phase Order & Dependencies

```
Phase 1: Scaffolding (Tasks 1-7)     — No dependencies, do first
Phase 2: Dashboard Shell (Task 8)     — Depends on Phase 1
Phase 3: Data Management (Tasks 9-11) — Depends on Phase 2
Phase 4: Flow Builder (Tasks 12-18)   — Depends on Phase 3 (needs environments for pipelines)
Phase 5: Config Gen (Tasks 19-22)     — Depends on Phase 4 (needs flow builder)
Phase 6: Fleet Monitor (Tasks 23-26)  — Depends on Phase 3 (needs fleet nodes)
Phase 7: Deployment (Tasks 27-31)     — Depends on Phase 5 + 6
Phase 8: Audit (Tasks 32-33)          — Can start after Phase 3
Phase 9: Settings (Tasks 34-36)       — Can start after Phase 1
Phase 10: VRL + Templates (37-39)     — Depends on Phase 4
Phase 11: Docker (Tasks 40-41)        — Can start after Phase 1
Phase 12: Polish (Tasks 42-44)        — Final phase, depends on all above
```

**Parallelizable:** Phases 6, 8, 9, and 11 can be developed in parallel with Phase 4-5.

**Total tasks:** 44
**Estimated commits:** ~44
