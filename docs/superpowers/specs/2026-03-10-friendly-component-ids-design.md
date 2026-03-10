# Friendly Component IDs

Decouple pipeline component identity from user-facing display names. Component keys become immutable UUID-based identifiers used only in the backend (YAML, metrics, agent protocol). A new `displayName` field provides the human-readable label users see and edit in the GUI.

## Problem

Today, `componentKey` serves as both the backend identifier (YAML keys, metrics matching, event sampling) and the user-facing label. Renaming a component changes the key, which requires a redeploy and orphans in-flight metrics. Users working in the GUI shouldn't need to trigger infrastructure changes just to rename a component.

## Design

### Data Model

Add a nullable `displayName` column to `PipelineNode`:

```prisma
model PipelineNode {
  // existing fields...
  componentKey  String        // Immutable. Format: {type}_{nanoid(8)}
  displayName   String?       // User-facing cosmetic name
  // ...
}
```

- `componentKey` -- generated once at node creation, never modified. Format: `{componentType}_{nanoid(8)}` using a custom alphanumeric alphabet (`0-9A-Za-z`, no hyphens) to remain compatible with existing componentKey regex `/^[a-zA-Z_][a-zA-Z0-9_]*$/` and YAML key requirements. Examples: `http_server_k7xMp2nQ`, `remap_vT3bL9wR`.
- `displayName` -- nullable, editable anytime. Defaults to `componentDef.displayName` (e.g., "HTTP Server") on node creation.
- Display logic throughout the app: `displayName ?? componentKey`.

### Component Key Generation & Immutability

**Node creation** (flow-store `addNode`):
- `componentKey = {componentDef.type}_{nanoid(8)}`
- `displayName = componentDef.displayName`

**Copy/paste & duplicate**: new UUID key generated, display name copied as-is (duplicates are fine -- display names are cosmetic).

**Immutability enforcement**:
- Remove `updateNodeKey` action from flow store.
- No user input path for `componentKey` -- generated once, stored, done.

**Validation**:
- `displayName`: permissive -- allow any printable characters (letters, numbers, spaces, hyphens, underscores, slashes, etc.) since some `componentDef.displayName` values may contain characters like `/`. Max 64 chars.
- `componentKey`: no user validation needed (system-generated).

### GUI Changes

**Node components** (source-node, transform-node, sink-node):
- Render `displayName ?? componentKey` as the node label.

**Detail panel**:
- Current "Component Key" input becomes "Name", bound to `displayName`.
- Remove "Letters, numbers, and underscores only" hint.
- Add a small read-only "Component ID" field showing the UUID key (subtle, for debugging).
- Editing the name sets `isDirty: true` (requires save) but does not require redeploy.

**Edge connections**: unaffected (use React Flow node `id`, not `componentKey`).

**Metrics overlay**: unaffected (matched by `componentKey` which is unchanged).

### Backend & Persistence

**Save pipeline**: persists both `componentKey` and `displayName`. Key written once on creation, never updated. Display name updates are a normal save.

**Deploy pipeline**: `generateVectorYaml()` uses `componentKey` for YAML keys. No changes.

**Metrics router**: matching logic (`componentId === pn.componentKey`) unchanged. Include `displayName` in frontend responses for GUI labeling.

**Event sampling**: uses `componentKey` throughout. No changes.

**Pipeline versions**: `nodesSnapshot` naturally includes `displayName` as part of node data.

**GitOps**: YAML uses UUID-based keys. Import leaves `displayName` null (falls back to key). No changes to git-sync or webhook handler.

### Migration & Backwards Compatibility

**Database migration**: `ALTER TABLE PipelineNode ADD COLUMN displayName TEXT` (nullable, no default).

**Existing pipelines**: no data migration. Old components keep `{type}_{timestamp}` keys. `displayName` is `NULL` -- GUI shows `componentKey` as fallback. Users can optionally set display names on old components (just requires save).

**New components**: get `{type}_{nanoid(8)}` keys and `displayName = componentDef.displayName`.

**Mixed pipelines**: old timestamp keys and new UUID keys coexist. The system treats keys as opaque strings.

**Not changing**: pipeline names, agent/heartbeat protocol, metrics store structure, YAML generation logic (beyond key format for new nodes), GitOps sync logic. Note: `displayName` is intentionally not written into YAML output.

### Implementation Notes

Files requiring `displayName` to be threaded through:

- **Prisma schema**: add `displayName String?` to `PipelineNode` model
- **FlowNodeData type** (`flow-store.ts`): add `displayName` to the interface
- **ClipboardData type** (`flow-store.ts`): include `displayName` for copy/paste
- **computeFlowFingerprint** (`flow-store.ts`): include `displayName` so renames trigger "unsaved changes"
- **nodeSchema** (`pipeline.ts`): add `displayName: z.string().nullable().optional()`
- **templateNodeSchema** (`template.ts`): same as above
- **dbNodesToFlowNodes** (`pipelines/[id]/page.tsx`): map `displayName` from DB row to node data
- **pasteFromSession** (`flow-store.ts`): generate fresh nanoid key (not collision-appended timestamp), copy displayName as-is
- **copyPipelineGraph** (`copy-pipeline-graph.ts`): preserve componentKey and displayName on clone/promote
- **Metrics router responses**: include `displayName` alongside `componentKey` in `getComponentMetrics` and `getNodePipelineRates` responses

### Known Trade-offs

- **GitOps full-graph replacement**: bidirectional GitOps does delete-and-recreate on import, so display names set in the GUI will be lost if the pipeline is overwritten from Git. Acceptable given the current architecture.
- **No uniqueness enforcement on displayName**: two nodes can share the same display name. Users distinguish them by expanding the Component ID debug field if needed.
