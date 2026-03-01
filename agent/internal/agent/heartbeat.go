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
			m := metrics.Scrape(s.APIPort)
			ps.EventsIn = m.EventsIn
			ps.EventsOut = m.EventsOut
			ps.BytesIn = m.BytesIn
			ps.BytesOut = m.BytesOut
			ps.ErrorsTotal = m.ErrorsTotal
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
		AgentVersion:  Version,
		VectorVersion: vectorVersion,
	}
}
