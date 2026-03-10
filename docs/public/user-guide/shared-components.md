# Shared Components

Shared components are reusable, environment-scoped pipeline component configurations that can be linked into multiple pipelines. Edit a shared component in one place and every linked pipeline sees the update -- no more hunting through dozens of pipelines to change an endpoint.

## How shared components work

A shared component stores a canonical configuration for a specific component type (e.g., an Elasticsearch sink with your production cluster settings). When you link a shared component into a pipeline, the pipeline node receives a snapshot of that configuration and pins to a specific version.

When someone edits the shared component, its version number increments. Linked pipelines don't change automatically -- instead, they surface an **Update available** indicator at three levels:

- **Pipeline list** -- An amber "Updates available" badge on the pipeline row.
- **Canvas** -- The linked node's footer changes to "Update available" with an amber dot.
- **Detail panel** -- A banner with an "Accept update" button.

Pipeline owners review and explicitly accept updates before redeploying. This review-first model prevents surprise breakage across production pipelines.

{% hint style="info" %}
Shared components are scoped to a single environment. A production Kafka config is separate from a staging one. If you need the same component in multiple environments, create a shared component in each.
{% endhint %}

## Finding shared components

Shared components are managed in the **Library** page, accessible from the sidebar. The Library has two sections:

- **Templates** -- Reusable pipeline blueprints (see [Templates](templates.md)).
- **Shared Components** -- Reusable component configurations (this page).

### Shared components list

The list shows all shared components in the currently selected environment:

| Column | Description |
|--------|-------------|
| **Name** | The shared component name. Click to open the detail page. |
| **Type** | The Vector component type (e.g., `elasticsearch`, `kafka`). |
| **Kind** | A badge indicating Source, Transform, or Sink. |
| **Linked Pipelines** | Number of distinct pipelines using this shared component. |
| **Version** | Current version number (increments on each config change). |
| **Last Updated** | When the configuration was last modified. |

## Creating a shared component

There are two ways to create a shared component.

### From the Library page

{% stepper %}
{% step %}
### Open the Library
Navigate to **Library > Shared Components** in the sidebar and click **New Shared Component**.
{% endstep %}
{% step %}
### Choose a component type
Select the component type from the catalog grid (e.g., Elasticsearch, Kafka, S3).
{% endstep %}
{% step %}
### Configure
Enter a **Name** and optional **Description**, then fill in the component configuration using the form editor. Click **Create** to save.
{% endstep %}
{% endstepper %}

### From the pipeline editor

{% stepper %}
{% step %}
### Right-click a node
In the pipeline editor, right-click any configured node on the canvas.
{% endstep %}
{% step %}
### Select Save as Shared Component
Choose **Save as Shared Component** from the context menu. A dialog opens.
{% endstep %}
{% step %}
### Name and save
Enter a **Name** and optional **Description**, then click **Save**. The node's current configuration becomes the shared component, and the node is automatically linked to it.
{% endstep %}
{% endstepper %}

## Using shared components in pipelines

### Adding from the component palette

The component palette (left sidebar in the pipeline editor) has two tabs:

- **Catalog** -- The standard list of all Vector component types.
- **Shared** -- Shared components available in the current environment.

The Shared tab includes kind filter buttons (All, Source, Transform, Sink) and supports search by name or component type. Drag a shared component from the list onto the canvas to create a linked node with the shared configuration pre-filled.

### Linked node appearance

Linked nodes are visually distinct on the canvas:

- **Purple accent border** -- A purple border and subtle glow distinguish linked nodes from regular ones.
- **Footer** -- Shows "Shared" with a link icon.
- **Stale indicator** -- When an update is available, the footer changes to "Update available" in amber, and a small amber dot appears on the node corner.

### Detail panel for linked nodes

When you select a linked node, the detail panel shows:

- A **purple banner** with the shared component name and an "Open in Library" link.
- **Read-only configuration** -- Config fields are disabled because the configuration is managed centrally. To edit, go to the Library page.
- An **Unlink** button in the header to convert back to a regular editable node.

{% hint style="warning" %}
Unlinking a node preserves its current configuration but breaks the connection to the shared component. Future updates to the shared component will not reach this node.
{% endhint %}

## Editing a shared component

{% stepper %}
{% step %}
### Open the detail page
Navigate to **Library > Shared Components** and click the shared component you want to edit.
{% endstep %}
{% step %}
### Modify the configuration
Update the configuration using the form editor. You can also edit the name and description.
{% endstep %}
{% step %}
### Save
Click **Save**. The version number increments automatically, and all linked pipelines will see an "Update available" indicator.
{% endstep %}
{% endstepper %}

The detail page also shows a **Linked Pipelines** section listing every pipeline that uses this shared component, with a badge indicating whether each is up to date or has a pending update.

## Accepting updates

When a shared component is updated, linked pipeline nodes become stale. Pipeline owners decide when to accept the new configuration.

### Single node

Select the stale node in the pipeline editor. The detail panel shows an amber banner with an **Accept update** button. Click it to pull in the latest configuration and update the pinned version.

### All nodes in a pipeline

If a pipeline has multiple stale linked nodes, you can accept all updates at once from the pipeline's toolbar or through the API.

{% hint style="info" %}
Accepting an update modifies the pipeline's saved configuration but does not automatically redeploy. You still need to deploy the pipeline to push the changes to agents.
{% endhint %}

## Deleting a shared component

On the shared component detail page, scroll to the **Danger Zone** section and click **Delete**. A confirmation dialog explains what will happen:

- All linked pipeline nodes are **unlinked** -- their configurations remain intact, but they become regular standalone nodes.
- The shared component is permanently removed from the Library.

{% hint style="danger" %}
Deleting a shared component cannot be undone. Linked nodes keep their last-synced configuration but lose the ability to receive future updates.
{% endhint %}

## Edge cases

| Scenario | Behavior |
|----------|----------|
| **Cloning a pipeline** | Linked nodes in the clone remain linked to the same shared components. |
| **Promoting a pipeline** | Shared component links are stripped during cross-environment promotion. Nodes retain their config snapshots as regular standalone nodes. |
| **Saving as template** | Templates are portable across environments, so shared component links are stripped. Template nodes store config snapshots only. |
| **Discarding changes** | Reverting to a previous version restores the shared component links as they were at that version. |
| **Copy/paste nodes** | Pasted nodes retain their link to the same shared component. |
| **GitOps / YAML export** | Generated YAML uses the resolved config snapshot. Importing from YAML creates regular unlinked nodes. |
