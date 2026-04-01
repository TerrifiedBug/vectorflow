# Anomaly Detection

VectorFlow continuously monitors your pipeline metrics and automatically detects statistical anomalies -- unusual spikes or drops that may indicate problems with your data pipelines.

## What anomalies are detected

The anomaly detector monitors three core metrics for each deployed pipeline:

| Metric | Spike anomaly | Drop anomaly |
|--------|---------------|--------------|
| **Events In** (throughput) | Throughput spike | Throughput drop |
| **Errors Total** | Error rate spike | -- (drops are expected) |
| **Latency Mean (ms)** | Latency spike | -- (drops are expected) |

Error and latency drops are not flagged because decreasing errors or latency is a positive signal, not an anomaly.

## Sigma-based detection methodology

Anomaly detection uses a statistical sigma (standard deviation) approach:

1. **Baseline computation** -- VectorFlow computes the mean and standard deviation of each metric over a rolling historical window (default: 7 days).
2. **Current comparison** -- The most recent metric value is compared against the baseline.
3. **Deviation factor** -- The number of standard deviations the current value is from the mean is calculated: `deviation = |current - mean| / stddev`.
4. **Threshold check** -- If the deviation factor exceeds the configured sigma threshold, an anomaly is raised.

A minimum standard deviation floor (default: 5% of the mean) prevents false positives on metrics that are nearly constant. For example, if throughput has been steady at 1000 events/interval with near-zero variance, a fluctuation of 50 events would not be flagged because it falls within the 5% floor.

{% hint style="info" %}
At least 24 data points are required to compute a reliable baseline. New pipelines will not generate anomalies until enough historical data has been collected.
{% endhint %}

## Sensitivity presets

The sigma threshold controls how sensitive the detector is. Lower values catch more anomalies but may produce more false positives:

| Preset | Sigma threshold | Description |
|--------|----------------|-------------|
| **Sensitive** | 2.0 sigma | Catches subtle changes. Higher false positive rate. |
| **Moderate** | 2.5 sigma | Balanced sensitivity for most environments. |
| **Balanced** | 3.0 sigma (default) | Standard statistical significance. Good for stable pipelines. |
| **Relaxed** | 4.0 sigma | Only flags extreme outliers. Minimal false positives. |

The sigma threshold and other parameters can be configured in **Settings > System** by a super admin. Changes are picked up within 60 seconds.

### Additional configuration options

| Setting | Default | Description |
|---------|---------|-------------|
| Baseline window | 7 days | How much historical data is used for computing the baseline. |
| Sigma threshold | 3.0 | Number of standard deviations to trigger an anomaly. |
| Min stddev floor | 5% | Minimum standard deviation as a percentage of the mean. |
| Dedup window | 4 hours | Cooldown before creating a duplicate anomaly for the same pipeline and type. |
| Enabled metrics | `eventsIn`, `errorsTotal`, `latencyMeanMs` | Which metrics to monitor. |

## Severity levels

Each detected anomaly is assigned a severity based on how far the metric has deviated:

| Severity | Condition |
|----------|-----------|
| **Warning** | Deviation is between the sigma threshold and threshold + 1 |
| **Critical** | Deviation exceeds sigma threshold + 1 |

For example, with a 3-sigma threshold, a deviation of 3.5 sigma is a **warning** and a deviation of 4.2 sigma is **critical**.

## Viewing anomalies

Anomalies appear in the **Anomalies** section of the environment dashboard. The list shows:

- **Pipeline name** -- Which pipeline the anomaly was detected on
- **Type** -- The anomaly type (throughput drop, throughput spike, error rate spike, latency spike)
- **Severity** -- Warning or critical
- **Message** -- A human-readable description including the current value, baseline mean, standard deviation, and sigma factor
- **Detected at** -- When the anomaly was first detected

Open anomaly counts are also shown as badges on pipeline cards throughout the UI.

## Acknowledging and dismissing anomalies

Anomalies have three statuses:

- **Open** -- Newly detected, awaiting review
- **Acknowledged** -- A team member has reviewed the anomaly and is investigating
- **Dismissed** -- The anomaly has been resolved or determined to be a false positive

From the anomaly list:

- Click **Acknowledge** to mark an anomaly as under investigation
- Click **Dismiss** to close the anomaly

{% hint style="info" %}
Acknowledging or dismissing anomalies requires the **Editor** role or above.
{% endhint %}

## Deduplication

To avoid alert fatigue, the detector will not create a new anomaly if an open or acknowledged anomaly already exists for the same pipeline and anomaly type within the deduplication window (default: 4 hours). This means you will see at most one active anomaly per pipeline per type at any given time.

## Detection schedule

The anomaly detector runs as a background job on the leader server instance every 5 minutes. It evaluates all deployed (non-draft) pipelines using two optimized SQL queries:

1. A batch query to fetch the latest metric values for all pipelines
2. Per-pipeline baseline queries (cached for 15 minutes) to compute mean and standard deviation

This design ensures detection scales efficiently even with hundreds of pipelines.
