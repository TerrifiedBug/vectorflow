package agent

import (
	"math"
	"time"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/metrics"
	"github.com/TerrifiedBug/vectorflow/agent/internal/selfmetrics"
	"github.com/TerrifiedBug/vectorflow/agent/internal/supervisor"
)

func buildHeartbeat(sup *supervisor.Supervisor, sm *selfmetrics.Metrics, vectorVersion string, deploymentMode string, sampleResults []client.SampleResultMsg, labels map[string]string, runningAs string) client.HeartbeatRequest {
	statuses := sup.Statuses()

	pipelines := make([]client.PipelineStatus, 0, len(statuses))
	var hostMetrics *client.HostMetrics

	for _, s := range statuses {
		uptimeSeconds := 0
		if s.Status == "RUNNING" || s.Status == "STARTING" {
			uptimeSeconds = int(math.Floor(time.Since(s.StartedAt).Seconds()))
		}

		ps := client.PipelineStatus{
			PipelineID:    s.PipelineID,
			Version:       s.Version,
			Status:        s.Status,
			PID:           s.PID,
			UptimeSeconds: uptimeSeconds,
		}

		// Scrape metrics from Vector's Prometheus endpoint for running pipelines
		if s.Status == "RUNNING" && s.MetricsPort > 0 {
			sr := metrics.ScrapePrometheus(s.MetricsPort)
			ps.EventsIn = sr.Pipeline.EventsIn
			ps.EventsOut = sr.Pipeline.EventsOut
			ps.BytesIn = sr.Pipeline.BytesIn
			ps.BytesOut = sr.Pipeline.BytesOut
			ps.ErrorsTotal = sr.Pipeline.ErrorsTotal
			ps.EventsDiscarded = sr.Pipeline.EventsDiscarded

			// Map per-component metrics for editor node overlays
			for _, cm := range sr.Components {
				ps.ComponentMetrics = append(ps.ComponentMetrics, client.ComponentMetric{
					ComponentID:        cm.ComponentID,
					ComponentKind:      cm.ComponentKind,
					ReceivedEvents:     cm.ReceivedEvents,
					SentEvents:         cm.SentEvents,
					ReceivedBytes:      cm.ReceivedBytes,
					SentBytes:          cm.SentBytes,
					ErrorsTotal:        cm.ErrorsTotal,
					DiscardedEvents:    cm.DiscardedEvents,
					LatencyMeanSeconds: cm.LatencyMeanSeconds,
				})
			}

			// Capture host metrics from the first running pipeline
			if hostMetrics == nil {
				hostMetrics = &client.HostMetrics{
					MemoryTotalBytes: sr.Host.MemoryTotalBytes,
					MemoryUsedBytes:  sr.Host.MemoryUsedBytes,
					MemoryFreeBytes:  sr.Host.MemoryFreeBytes,
					CpuSecondsTotal:  sr.Host.CpuSecondsTotal,
				CpuSecondsIdle:   sr.Host.CpuSecondsIdle,
					LoadAvg1:         sr.Host.LoadAvg1,
					LoadAvg5:         sr.Host.LoadAvg5,
					LoadAvg15:        sr.Host.LoadAvg15,
					FsTotalBytes:     sr.Host.FsTotalBytes,
					FsUsedBytes:      sr.Host.FsUsedBytes,
					FsFreeBytes:      sr.Host.FsFreeBytes,
					DiskReadBytes:    sr.Host.DiskReadBytes,
					DiskWrittenBytes: sr.Host.DiskWrittenBytes,
					NetRxBytes:       sr.Host.NetRxBytes,
					NetTxBytes:       sr.Host.NetTxBytes,
				}
			}
		}

		// Include config checksum from last applied config
		ps.ConfigChecksum = s.ConfigChecksum

		// Logs are now flushed by the dedicated log flusher goroutine.
		// RecentLogs field is kept on the struct for backward compat but no longer populated here.

		pipelines = append(pipelines, ps)
	}

	// Embed a snapshot of agent self-health so the server can surface it
	// without requiring a separate Prometheus scrape of the agent.
	snap := sm.Snap()
	agentHealth := &client.AgentHealth{
		PollErrorsTotal:      snap.PollErrorsTotal,
		PushReconnectsTotal:  snap.PushReconnectsTotal,
		HeartbeatErrorsTotal: snap.HeartbeatErrorsTotal,
		PushConnected:        snap.PushConnected,
		PipelinesRunning:     snap.PipelinesRunning,
		UptimeSeconds:        snap.UptimeSeconds,
	}

	return client.HeartbeatRequest{
		Pipelines:      pipelines,
		HostMetrics:    hostMetrics,
		AgentVersion:   Version,
		VectorVersion:  vectorVersion,
		DeploymentMode: deploymentMode,
		RunningAs:      runningAs,
		SampleResults:  sampleResults,
		Labels:         labels,
		AgentHealth:    agentHealth,
	}
}
