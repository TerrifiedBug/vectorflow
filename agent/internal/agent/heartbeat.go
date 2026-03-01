package agent

import (
	"math"
	"time"

	"github.com/vectorflow/agent/internal/client"
	"github.com/vectorflow/agent/internal/metrics"
	"github.com/vectorflow/agent/internal/supervisor"
)

func buildHeartbeat(sup *supervisor.Supervisor, vectorVersion string) client.HeartbeatRequest {
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

		// Scrape live metrics from Vector's GraphQL API for running pipelines
		if s.Status == "RUNNING" && s.APIPort > 0 {
			sr := metrics.Scrape(s.APIPort)
			ps.EventsIn = sr.Pipeline.EventsIn
			ps.EventsOut = sr.Pipeline.EventsOut
			ps.BytesIn = sr.Pipeline.BytesIn
			ps.BytesOut = sr.Pipeline.BytesOut
			ps.ErrorsTotal = sr.Pipeline.ErrorsTotal

			// Capture host metrics from the first running pipeline's API
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
		Pipelines:     pipelines,
		HostMetrics:   hostMetrics,
		AgentVersion:  Version,
		VectorVersion: vectorVersion,
	}
}
