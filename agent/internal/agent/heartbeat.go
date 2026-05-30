package agent

import (
	"context"
	"math"
	"sync"
	"time"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/metrics"
	"github.com/TerrifiedBug/vectorflow/agent/internal/selfmetrics"
	"github.com/TerrifiedBug/vectorflow/agent/internal/supervisor"
)

// scrapeFunc scrapes a single Vector metrics endpoint. It is a package var so
// tests can substitute a fake without spinning up real HTTP servers.
var scrapeFunc = metrics.ScrapePrometheusContext

// heartbeatScrapeTimeout bounds the total time spent scraping every running
// pipeline's metrics endpoint while assembling a heartbeat. Scrapes run in
// parallel, so this is a ceiling on the whole batch — a single slow or hung
// Vector endpoint can no longer stall heartbeats or shutdown.
const heartbeatScrapeTimeout = 4 * time.Second

// scrapeRunningPipelines scrapes every RUNNING pipeline's metrics endpoint
// concurrently, bounded by ctx, and returns the results keyed by the pipeline's
// index in statuses. Pipelines that are not running (or have no metrics port)
// are absent from the map. Running the scrapes in parallel keeps the caller off
// the critical path: the slowest endpoint, not the sum of all endpoints, sets
// the latency, and ctx cancellation short-circuits the wait.
func scrapeRunningPipelines(ctx context.Context, statuses []supervisor.ProcessInfo) map[int]metrics.ScrapeResult {
	results := make(map[int]metrics.ScrapeResult)
	var (
		mu sync.Mutex
		wg sync.WaitGroup
	)
	for i, s := range statuses {
		if s.Status != "RUNNING" || s.MetricsPort <= 0 {
			continue
		}
		wg.Add(1)
		go func(idx, port int) {
			defer wg.Done()
			sr := scrapeFunc(ctx, port)
			mu.Lock()
			results[idx] = sr
			mu.Unlock()
		}(i, s.MetricsPort)
	}
	wg.Wait()
	return results
}

func buildHeartbeat(ctx context.Context, sup pipelineSupervisor, sm *selfmetrics.Metrics, vectorVersion string, deploymentMode string, sampleResults []client.SampleResultMsg, labels map[string]string, runningAs string) client.HeartbeatRequest {
	statuses := sup.Statuses()

	// Scrape all running pipelines in parallel under a bounded timeout so a slow
	// or hung Vector metrics endpoint cannot stall the control loop. The derived
	// context is also cancelled when the parent ctx is (e.g. on shutdown).
	scrapeCtx, cancel := context.WithTimeout(ctx, heartbeatScrapeTimeout)
	defer cancel()
	scrapes := scrapeRunningPipelines(scrapeCtx, statuses)

	pipelines := make([]client.PipelineStatus, 0, len(statuses))
	var hostMetrics *client.HostMetrics

	for i, s := range statuses {
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

		// Apply the (already-collected) metrics scrape for running pipelines.
		if sr, ok := scrapes[i]; ok {
			ps.EventsIn = sr.Pipeline.EventsIn
			ps.EventsOut = sr.Pipeline.EventsOut
			ps.BytesIn = sr.Pipeline.BytesIn
			ps.BytesOut = sr.Pipeline.BytesOut
			ps.ErrorsTotal = sr.Pipeline.ErrorsTotal
			ps.EventsDiscarded = sr.Pipeline.EventsDiscarded
			ps.Utilization = sr.Pipeline.Utilization

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
