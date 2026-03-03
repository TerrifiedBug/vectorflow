package agent

import (
	"math"
	"time"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/metrics"
	"github.com/TerrifiedBug/vectorflow/agent/internal/supervisor"
)

func buildHeartbeat(sup *supervisor.Supervisor, vectorVersion string, deploymentMode string, sampleResults []client.SampleResultMsg) client.HeartbeatRequest {
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
					ComponentID:     cm.ComponentID,
					ComponentKind:   cm.ComponentKind,
					ReceivedEvents:  cm.ReceivedEvents,
					SentEvents:      cm.SentEvents,
					ReceivedBytes:   cm.ReceivedBytes,
					SentBytes:       cm.SentBytes,
					ErrorsTotal:     cm.ErrorsTotal,
					DiscardedEvents: cm.DiscardedEvents,
				})
			}

			// Capture host metrics from the first running pipeline
			if hostMetrics == nil {
				hostMetrics = &client.HostMetrics{
					MemoryTotalBytes: sr.Host.MemoryTotalBytes,
					MemoryUsedBytes:  sr.Host.MemoryUsedBytes,
					MemoryFreeBytes:  sr.Host.MemoryFreeBytes,
					CpuSecondsTotal:  sr.Host.CpuSecondsTotal,
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

		// Include recent stdout/stderr lines (max 100 per heartbeat)
		logs := sup.GetRecentLogs(s.PipelineID)
		if len(logs) > 100 {
			logs = logs[len(logs)-100:]
		}
		ps.RecentLogs = logs

		pipelines = append(pipelines, ps)
	}

	return client.HeartbeatRequest{
		Pipelines:      pipelines,
		HostMetrics:    hostMetrics,
		AgentVersion:   Version,
		VectorVersion:  vectorVersion,
		DeploymentMode: deploymentMode,
		SampleResults:  sampleResults,
	}
}
