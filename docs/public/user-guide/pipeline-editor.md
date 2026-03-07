# Pipeline Editor

The pipeline editor is a visual canvas where you design data pipelines by connecting sources, transforms, and sinks. It provides a drag-and-drop interface powered by a flow-graph layout, so you can build and modify pipelines without writing configuration files by hand.

![Pipeline Editor](../screenshots/pipeline-editor.png)

## Editor layout

The editor is divided into four main areas:

| Area | Location | Purpose |
|------|----------|---------|
| **Component Palette** | Left sidebar | Lists all available Vector component types, organized by kind and category. |
| **Canvas** | Center | The main workspace where you arrange and connect nodes. |
| **Detail Panel** | Right sidebar | Configuration form for the currently selected node. |
| **Toolbar** | Top bar | Actions for saving, validating, deploying, and managing the pipeline. |

## Component palette

The left sidebar lists every available Vector component, grouped into three sections:

- **Sources** -- Components that ingest data into the pipeline.
- **Transforms** -- Components that process, filter, or reshape data in flight.
- **Sinks** -- Components that send data to downstream destinations.

Each section can be collapsed. When a section contains many components, they are further organized by category (e.g. "Cloud Platform", "Aggregating", "Messaging").

Use the **search bar** at the top of the palette to filter components by name, type, description, or category.

### Adding a component

Drag a component from the palette and drop it onto the canvas. A new node appears at the drop position, pre-configured with sensible defaults. You can also right-click the canvas to paste previously copied nodes.

## Canvas

The canvas is where your pipeline takes visual shape. Each component is represented as a **node**, and data flow between components is represented as **edges** (connections).

### Interacting with the canvas

- **Pan** -- Click and drag on empty canvas space to move around.
- **Zoom** -- Use the scroll wheel or the zoom controls in the bottom-left corner.
- **Select a node** -- Click a node to select it. Its configuration appears in the detail panel on the right.
- **Multi-select** -- Hold Shift and click additional nodes to select multiple components at once. The detail panel shows bulk actions (Copy All, Delete All).
- **Reposition** -- Drag a node to move it to a new position on the canvas.
- **Connect nodes** -- Drag from a node's output port (right side) to another node's input port (left side) to create a connection. The editor enforces data-type compatibility and prevents self-connections.
- **Fit to view** -- The canvas automatically fits all nodes into view when first loaded. Use the zoom controls to reset the view.

### Context menus

- **Right-click a node** -- Opens a menu with Copy, Paste, Duplicate, and Delete actions.
- **Right-click an edge** -- Opens a menu with a Delete connection action.

## Node types

### Sources

Sources are where data **enters** the pipeline. They have an output port on the right side and are color-coded green. Examples include:

- `syslog` -- Receive syslog messages over TCP or UDP
- `file` -- Tail log files from disk
- `kafka` -- Consume from Kafka topics
- `http_server` -- Accept events over HTTP
- `demo_logs` -- Generate synthetic log events for testing
- `datadog_agent`, `splunk_hec` -- Receive data from vendor agents

### Transforms

Transforms **process and modify** data as it flows through the pipeline. They have both an input port (left) and an output port (right), and are color-coded blue. Key types include:

- `remap` -- Apply VRL (Vector Remap Language) expressions to reshape events
- `filter` -- Drop events that do not match a VRL condition
- `sample` -- Randomly sample a percentage of events
- `route` -- Split events into multiple outputs based on VRL conditions
- `dedupe` -- Remove duplicate events based on field values
- `reduce` -- Aggregate multiple events into one
- `log_to_metric` -- Convert log events into metric data

### Sinks

Sinks are where data **exits** the pipeline to downstream destinations. They have an input port on the left side and are color-coded orange. Examples include:

- `elasticsearch` -- Send to Elasticsearch / OpenSearch
- `aws_s3` -- Write to Amazon S3 buckets
- `http` -- Forward over HTTP to any endpoint
- `console` -- Print to standard output (useful for debugging)
- `datadog_logs`, `splunk_hec_logs` -- Send to vendor platforms
- `kafka` -- Produce to Kafka topics
- `loki` -- Send to Grafana Loki

### Live metrics on nodes

When a pipeline is deployed, each node displays live throughput metrics directly on the canvas:

- **Events per second** and **bytes per second** in a compact readout
- A **status dot** indicating health (green for healthy, amber for degraded)
- A **sparkline** showing recent throughput trends

![Node Details](../screenshots/node-details.png)

## Detail panel

Click any node on the canvas to open its configuration in the detail panel on the right.

The panel has two tabs:

- **Config** -- The component configuration form (always visible).
- **Live Tail** -- Sample live events flowing through the component (visible only when the pipeline is deployed). See [Live Tail](#live-tail) below.

The **Config** tab shows:

- **Component name and kind** -- The display name, a badge indicating source/transform/sink, and a delete button.
- **Component Key** -- A unique identifier for this component within the pipeline (e.g. `traefik_logs`). Must contain only letters, numbers, and underscores.
- **Enabled toggle** -- Disable a component to exclude it from the generated configuration without removing it from the canvas.
- **Type** -- The Vector component type (read-only).
- **Configuration form** -- Auto-generated form fields based on the component's configuration schema. Required fields are marked, and each field has contextual help.
- **Secret picker** -- Sensitive fields (passwords, API keys, tokens) display a secret picker instead of a text input. You must select an existing secret or create a new one inline -- plaintext values cannot be entered directly into sensitive fields. See [Security](../operations/security.md#sensitive-fields) for details.

### VRL editor for transforms

For **remap**, **filter**, and **route** transforms, the detail panel includes an integrated VRL editor (powered by Monaco) instead of a plain text field. The VRL editor provides:

- Syntax highlighting for VRL code
- Autocomplete for VRL functions
- An inline snippet drawer to insert common VRL patterns (see [VRL Snippets](vrl-snippets.md))
- A fields panel showing the schema of upstream source events
- A test runner that lets you execute your VRL code against sample JSON events and see the output

## Toolbar

The toolbar runs along the top of the editor and provides the following actions (left to right):

| Action | Shortcut | Description |
|--------|----------|-------------|
| **Save** | `Cmd+S` | Save the current pipeline state. A dot indicator appears when there are unsaved changes. |
| **Validate** | -- | Run server-side validation on the generated Vector configuration and report any errors. |
| **Undo** | `Cmd+Z` | Undo the last change. |
| **Redo** | `Cmd+Shift+Z` | Redo a previously undone change. |
| **Delete** | `Delete` | Delete the currently selected node or edge. |
| **Import** | `Cmd+I` | Import a Vector configuration file (YAML or TOML) to populate the canvas. |
| **Export** | `Cmd+E` | Export the pipeline as a YAML or TOML file. |
| **Save as Template** | -- | Save the current pipeline layout as a reusable template. |
| **Version History** | -- | View all deployed versions, compare diffs, and rollback to a previous version. |
| **Metrics** | -- | Toggle the metrics chart panel at the bottom of the editor. |
| **Logs** | -- | Toggle the live logs panel. A red dot appears when recent errors have been detected. |
| **Settings** | -- | Open pipeline-level settings (log level, global configuration). A blue dot indicates active global config. |

### Deploy and undeploy

The right side of the toolbar shows the current deployment state:

- **Deploy** button -- Appears when the pipeline has never been deployed, or when changes have been made since the last deployment. Clicking Deploy first auto-saves, then opens the deploy dialog.
- **Deployed** indicator -- A green checkmark shown when the deployed configuration matches the saved state.
- **Undeploy** button -- Stops the pipeline on all agents and reverts it to draft status. You can redeploy at any time.
- **Process status** -- A colored dot and label showing the runtime status: Running (green), Starting (yellow), Stopped (gray), or Crashed (red).

## Pipeline logs panel

Toggle the logs panel from the toolbar to view real-time logs from the running pipeline. The panel supports:

- Filtering by log level (ERROR, WARN, INFO, DEBUG)
- Filtering by agent node
- Cursor-based pagination for scrolling through history

{% hint style="info" %}
The logs panel only shows data for deployed pipelines. Draft pipelines have no running processes to produce logs.
{% endhint %}

## Live Tail

Live Tail lets you sample real events flowing through any component in a deployed pipeline, directly from the detail panel. This is useful for verifying that data is being ingested, transformed, and routed as expected.

### How to use Live Tail

{% stepper %}

{% step %}
### Deploy the pipeline
Live Tail requires a running pipeline. If the pipeline is still a draft, deploy it first using the **Deploy** button in the toolbar.
{% endstep %}

{% step %}
### Select a component
Click any node on the canvas to open the detail panel.
{% endstep %}

{% step %}
### Switch to the Live Tail tab
In the detail panel, click the **Live Tail** tab. This tab only appears for deployed pipelines.
{% endstep %}

{% step %}
### Sample events
Click **Sample 10 Events** to request a batch of live events from the selected component. The panel polls for results and displays them as they arrive.
{% endstep %}

{% endstepper %}

Each sampled event appears as a collapsed row showing a JSON preview. Click any row to expand it and view the full event payload with formatted JSON.

- Events are shown newest-first, and the panel retains up to 50 events across multiple sampling requests.
- Each sampling request has a two-minute expiry. If no events are captured within that window, the request expires silently.
- You can sample from any component type -- sources, transforms, or sinks.

{% hint style="info" %}
Live Tail uses the agent's event sampling infrastructure. The agent captures a snapshot of events passing through the selected component and returns them on its next heartbeat. There is no persistent stream -- each click of "Sample 10 Events" triggers a new one-shot capture.
{% endhint %}

## Pipeline rename

Click the pipeline name in the top-left corner of the editor to rename it inline. Press Enter to confirm or Escape to cancel.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+S` | Save pipeline |
| `Cmd+Z` | Undo |
| `Cmd+Shift+Z` | Redo |
| `Cmd+C` | Copy selected node(s) |
| `Cmd+V` | Paste copied node(s) |
| `Cmd+D` | Duplicate selected node |
| `Cmd+E` | Export configuration |
| `Cmd+I` | Import configuration |
| `Delete` / `Backspace` | Delete selected node or edge |

{% hint style="info" %}
On Windows and Linux, use `Ctrl` instead of `Cmd` for all keyboard shortcuts.
{% endhint %}
