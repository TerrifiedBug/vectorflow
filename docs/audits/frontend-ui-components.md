# Frontend UI & Components Audit

**Ticket:** V-12
**Date:** 2026-04-06
**Scope:** React component structure, state management, accessibility, React 19/Next.js 16 patterns, TODOs/FIXMEs, bundle concerns

---

## Codebase Overview

- **306 frontend source files** total: 164 components, 43 hooks, 8 stores, 91 app routes
- **React 19.2.3** + **Next.js 16.1.7** with App Router
- **State:** Zustand (UI) + TanStack React Query v5 (server)

```
src/
├── app/                 # Next.js App Router (91 pages/layouts)
│   ├── (auth)/         # Authentication flow
│   └── (dashboard)/    # Main dashboard layout group
├── components/          # 164 UI components
│   ├── ui/             # shadcn/ui primitives (50+ files)
│   ├── flow/           # React Flow visual editor
│   ├── dashboard/      # Dashboard-specific
│   ├── fleet/          # Fleet management
│   ├── pipeline/       # Pipeline features
│   ├── vrl-editor/     # VRL code editor
│   ├── config-forms/   # Schema-driven form builder
│   └── motion/         # Animation components
├── hooks/               # 43 custom React hooks
└── stores/              # 8 Zustand stores
```

---

## Findings

### 🔴 High Severity

#### 1. Over-use of `"use client"` — Near-zero RSC adoption
- **212 components** have the `"use client"` directive; **0** use `"use server"`
- Root `layout.tsx` is correctly a Server Component but all dashboard/settings pages are fully client-rendered
- Pages with read-only data display could be RSCs with narrow client leaf nodes
- **Impact:** Increases initial bundle size; forgoes streaming and server-side data fetching benefits

#### 2. Only 1 `dynamic()` import — No code splitting on heavy dialogs
- `src/components/vrl-editor/vrl-editor.tsx:40` — only Monaco Editor is lazy-loaded
- `src/components/flow/deploy-dialog.tsx` (843 lines) and `src/components/flow/pipeline-settings.tsx` (1,184 lines) load eagerly with the main bundle
- **Fix:** Apply `dynamic(() => import('./deploy-dialog'))` for heavy feature dialogs

#### 3. Unsafe private Zustand store access via type casting
- `src/components/flow/ai-pipeline-dialog.tsx:65` — `(s as unknown as { _past: unknown[] })._past`
- `src/components/flow/ai-pipeline-dialog.tsx:164` — `s as unknown as Record<string, unknown>`
- `src/components/flow/ai-pipeline-dialog.tsx:330` — Same pattern via `getState()`
- Breaks encapsulation; if store internals change, this silently returns `undefined`
- **Fix:** Expose a public `pastLength` getter in `flow-store.ts`

#### 4. Monolithic components exceeding 800 lines
| File | Lines | Issue |
|---|---|---|
| `src/components/flow/pipeline-settings.tsx` | 1,184 | 26+ hooks; manages tags, enrichment, rollback, deployment strategy, health — all in one component |
| `src/stores/flow-store.ts` | 1,054 | Selection logic, clipboard, canvas search, AI suggestions could be separate stores |
| `src/components/flow/deploy-dialog.tsx` | 843 | Deploy flow, progress tracking, and history in one dialog |
| `src/components/ui/sidebar.tsx` | 727 | — |

---

### 🟡 Medium Severity

#### 5. `react-hooks` ESLint suppressions hiding effect bugs
- `src/components/flow/pipeline-settings.tsx:135,367,530` — `react-hooks/set-state-in-effect` suppressed 3×
- `src/components/flow/deploy-dialog.tsx:97,107,289` — same rule suppressed 3×
- `src/components/flow/transform-node.tsx:86` — `react-hooks/static-components` suppressed
- `src/components/vrl-editor/vrl-editor.tsx:257` — `react-hooks/set-state-in-effect` suppressed
- setState-in-effect without stable dependencies can cause stale closure bugs and infinite re-renders
- **Fix:** Extract to `useReducer` or stabilize effect dependencies; do not suppress

#### 6. `next-auth` on beta channel
- `package.json` — `next-auth: "5.0.0-beta.30"`
- Auth is a critical path; pinned to a pre-release version
- **Fix:** Track stable `5.x` release and upgrade when available

#### 7. Component test coverage ~6%
- 10 test files for 164 components
- Flow editor has tests; most UI primitives, forms, and dialogs do not
- Accessibility test suite covers only structural checks (no keyboard navigation, no screen-reader flow)

#### 8. `<img>` instead of Next.js `<Image>` on TOTP setup card
- `src/components/totp-setup-card.tsx:205` — `eslint-disable @next/next/no-img-element` suppresses the warning
- **Fix:** Use `<Image>` with explicit dimensions, or add `unoptimized` prop with justification comment

#### 9. `any` type in analytics component
- `src/components/analytics/recommendations-panel.tsx:110` — `eslint-disable @typescript-eslint/no-explicit-any`
- Isolated but should be typed properly

---

### 🟢 Low Severity

#### 10. No internationalization (i18n)
- All UI text is hardcoded English; no i18n library
- Not an immediate concern unless multi-language support is planned

#### 11. No Web Vitals / performance monitoring
- No `next/vitals` or real-user monitoring integration

---

## TODOs / FIXMEs

**No `// TODO`, `// FIXME`, or `// HACK` comments in frontend component/hook files.** Clean.

---

## Strengths Worth Preserving

| Area | Notes |
|---|---|
| **SSE architecture** | `src/hooks/use-sse.ts` — exponential backoff, tab visibility detection, event buffering. Excellent. |
| **Flow store undo/redo** | Fingerprint-based dirty-state tracking, MAX_HISTORY=50, well-structured |
| **State separation** | Zustand for UI state, React Query for server state — clean boundary |
| **Accessibility baseline** | Automated axe-core WCAG 2.1 AA scanning in `src/__tests__/accessibility.test.tsx` |
| **TypeScript strictness** | Zero `any` escapes outside 2 suppressed instances; `as unknown as` confined to 1 file |
| **React 19 adoption** | `use()` hook used correctly for async route params; Suspense boundaries on key pages |

---

## Recommendations

**High priority:**
1. Expose `pastLength` as a public selector in `flow-store.ts`; remove all `_past` casts in `ai-pipeline-dialog.tsx`
2. Add `dynamic()` imports for `deploy-dialog` and `pipeline-settings`
3. Convert read-only dashboard pages to Server Components; push `"use client"` to leaf interactive nodes
4. Break `pipeline-settings.tsx` into focused sub-components (StrategySelector, HealthCheckSettings, etc.)

**Medium priority:**
5. Fix or document all `react-hooks/set-state-in-effect` suppressions
6. Track `next-auth` stable release
7. Expand component test coverage — prioritize flow editor dialogs and config forms
8. Deepen accessibility tests with keyboard navigation and screen-reader flows

**Low priority:**
9. Replace `<img>` with `<Image>` in `totp-setup-card.tsx`
10. Evaluate i18n requirements
11. Add Web Vitals reporting
