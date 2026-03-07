# Dashboard

The dashboard is the landing page you see after logging in. It gives you a high-level view of your observability pipeline health across the selected environment, with real-time metrics, fleet status, and interactive charts.

![Dashboard](../screenshots/dashboard.png)

## KPI summary cards

The top of the dashboard displays five summary cards that provide an at-a-glance overview of your environment.

| Card | What it shows |
|------|--------------|
| **Total Nodes** | The number of Vector agent nodes registered in the current environment. |
| **Node Health** | A breakdown of node statuses -- **Healthy**, **Degraded**, or **Unreachable** -- so you can spot issues quickly. |
| **Pipelines** | The total number of deployed (non-draft) pipelines in the environment. |
| **Pipeline Status** | Counts of pipelines by runtime state: **Running**, **Stopped**, or **Crashed**. |
| **Log Reduction** | The percentage of data volume reduced by your transforms (see below). |

## Log reduction percentage

The **Log Reduction** card shows how effectively your pipelines are filtering and transforming data before it reaches your sinks. The formula is:

```
reduction % = (1 - eventsOut / eventsIn) * 100
```

- A **higher percentage** means more data is being filtered, sampled, or deduplicated by your transforms before reaching downstream destinations.
- The value is **clamped to 0% minimum** -- if your pipeline produces more events than it receives (e.g. through event splitting), the card shows 0% rather than a negative number.
- The card also displays the raw events-per-second rates for both input and output so you can see absolute throughput.
- Color coding provides quick visual feedback: green for reductions above 50%, amber for 10--50%, and neutral for lower values.

{% hint style="info" %}
Reduction metrics are calculated from the last hour of aggregated pipeline data. If no traffic has flowed recently the card will display a dash.
{% endhint %}

## Metrics filter bar

Below the summary cards, a filter bar lets you narrow down the charts displayed on the dashboard.

- **Time range** -- Choose from **1 hour**, **6 hours**, **1 day**, or **7 days**. The selected window controls both the data shown in the charts and the automatic refresh interval.
- **Pipeline filter** -- Select one or more pipelines to focus on. When no pipelines are selected, all deployed pipelines in the environment are shown.
- **Node filter** -- Select specific agent nodes. Filtering by node automatically restricts the pipeline list to pipelines running on those nodes, and vice versa.
- **Group by** -- Choose how chart series are broken down:
  - **Pipeline** -- one series per pipeline (default)
  - **Node** -- one series per agent node
  - **Aggregate** -- a single "Total" series combining all pipelines and nodes

## Pipeline metrics charts

The **Pipeline Metrics** section includes three charts:

- **Events In/Out per Second** -- Shows the rate of events entering your sources and leaving your sinks. Comparing the two lines reveals how much data your transforms are reducing.
- **Bytes In/Out per Second** -- The same comparison in bytes, useful for understanding bandwidth and storage impact.
- **Errors & Discarded** -- An area chart showing error rates and discarded event rates. A spike here may indicate a misconfigured transform or an unreachable sink.

## System metrics charts

The **System Metrics** section shows resource utilization for the agent nodes in your environment:

- **CPU Usage** -- Percentage of CPU consumed by each Vector agent. Capped at 100%.
- **Memory Usage** -- Percentage of available memory used by each agent.
- **Disk I/O** -- Read and write throughput in bytes per second.
- **Network I/O** -- Receive (Rx) and transmit (Tx) throughput in bytes per second.

When **Group by** is set to **Aggregate**, CPU and memory are averaged across nodes while disk and network rates are summed.

{% hint style="warning" %}
System metrics require the VectorFlow agent to be reporting node-level telemetry. If a node is unreachable, its metrics will stop updating until connectivity is restored.
{% endhint %}

## Auto-refresh

Dashboard data refreshes automatically based on the selected time range:

| Time range | Refresh interval |
|-----------|-----------------|
| 1 hour | 15 seconds |
| 6 hours | 60 seconds |
| 1 day | 60 seconds |
| 7 days | 5 minutes |

Pipeline status cards also poll every 15 seconds regardless of the selected time range, so you will see status changes (Running, Stopped, Crashed) promptly.

## Data Volume Analytics

The **Analytics** page (accessible from the sidebar) provides a dedicated view of data volume across your pipelines. It is designed to help you understand how much data is flowing through your environment and how effectively your pipelines are reducing it over time.

### Time range selector

At the top of the page, choose from **1h**, **6h**, **1d**, **7d**, or **30d**. The selected window determines the data shown in the KPI cards, chart, and per-pipeline table. It also sets the previous comparison period -- for example, selecting **1d** compares the last 24 hours against the 24 hours before that.

### KPI cards

Three summary cards appear at the top:

| Card | What it shows |
|------|--------------|
| **Total In** | The total bytes received across all pipelines in the selected period. Includes a trend arrow and percentage change compared to the previous period. |
| **Total Out** | The total bytes sent by all sinks. Also shows trend vs. the previous period. |
| **Reduction %** | The data reduction percentage: `(1 - bytesOut / bytesIn) * 100`. Shows the percentage-point change compared to the previous period. Color-coded green (above 50%), amber (10--50%), or neutral. |

### Volume over time chart

An area chart shows **Bytes In** (blue) and **Bytes Out** (green) over the selected time window. The X-axis adapts its label format to the time range -- times for shorter windows, dates for longer ones. Hover over data points to see exact values.

### Per-pipeline breakdown table

Below the chart, a table lists every pipeline that processed data during the selected period:

| Column | Description |
|--------|------------|
| **Pipeline Name** | The name of the pipeline. |
| **Bytes In** | Total bytes received by that pipeline's sources. |
| **Bytes Out** | Total bytes sent by that pipeline's sinks. |
| **Reduction %** | Per-pipeline reduction percentage, shown with a colored bar. Higher reduction values display a longer, greener bar; lower values show shorter, red-tinted bars. |

Click any column header to sort the table by that column. Click again to toggle between ascending and descending order.

{% hint style="info" %}
The Analytics page auto-refreshes at the same intervals as the dashboard: every 15 seconds for 1h, 60 seconds for 6h, and 120 seconds for longer ranges.
{% endhint %}
