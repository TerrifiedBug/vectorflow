package agent

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/TerrifiedBug/vectorflow/agent/internal/metrics"
	"github.com/TerrifiedBug/vectorflow/agent/internal/supervisor"
)

// withScrapeFunc swaps the package scrapeFunc for the duration of a test and
// restores it afterwards.
func withScrapeFunc(t *testing.T, fn func(ctx context.Context, port int) metrics.ScrapeResult) {
	t.Helper()
	orig := scrapeFunc
	scrapeFunc = fn
	t.Cleanup(func() { scrapeFunc = orig })
}

func runningStatus(id string, port int) supervisor.ProcessInfo {
	return supervisor.ProcessInfo{
		PipelineID:  id,
		Status:      "RUNNING",
		MetricsPort: port,
		StartedAt:   time.Now(),
	}
}

// TestBuildHeartbeatScrapesInParallel verifies VF #157: per-pipeline scrapes run
// concurrently, so total scrape latency is bounded by the slowest endpoint, not
// the sum of all endpoints. With N pipelines each sleeping D, a sequential
// implementation would take ~N*D; the parallel one takes ~D.
func TestBuildHeartbeatScrapesInParallel(t *testing.T) {
	const n = 5
	const perScrape = 100 * time.Millisecond

	var concurrent int32
	var maxConcurrent int32
	withScrapeFunc(t, func(ctx context.Context, port int) metrics.ScrapeResult {
		cur := atomic.AddInt32(&concurrent, 1)
		for {
			old := atomic.LoadInt32(&maxConcurrent)
			if cur <= old || atomic.CompareAndSwapInt32(&maxConcurrent, old, cur) {
				break
			}
		}
		defer atomic.AddInt32(&concurrent, -1)

		select {
		case <-time.After(perScrape):
		case <-ctx.Done():
		}
		return metrics.ScrapeResult{}
	})

	sup := &mockSupervisor{}
	for i := 0; i < n; i++ {
		sup.statuses = append(sup.statuses, runningStatus(string(rune('a'+i)), 9000+i))
	}

	start := time.Now()
	hb := buildHeartbeat(context.Background(), sup, newTestMetrics(), "0.54.0", "STANDALONE", nil, nil, "u")
	elapsed := time.Since(start)

	if len(hb.Pipelines) != n {
		t.Fatalf("expected %d pipelines in heartbeat, got %d", n, len(hb.Pipelines))
	}
	// Sequential would be ~n*perScrape; allow generous headroom for scheduling.
	if elapsed >= time.Duration(n)*perScrape {
		t.Errorf("scrapes appear sequential: elapsed %v >= sequential bound %v", elapsed, time.Duration(n)*perScrape)
	}
	if got := atomic.LoadInt32(&maxConcurrent); got < 2 {
		t.Errorf("expected scrapes to overlap (maxConcurrent>=2), got %d", got)
	}
}

// TestBuildHeartbeatScrapeTimeoutDoesNotBlock verifies that a hung Vector
// metrics endpoint cannot stall heartbeat assembly: the bounded scrape context
// cancels and buildHeartbeat returns promptly even though the scrape "hangs"
// until its context is cancelled.
func TestBuildHeartbeatScrapeTimeoutDoesNotBlock(t *testing.T) {
	withScrapeFunc(t, func(ctx context.Context, port int) metrics.ScrapeResult {
		// Simulate a hung endpoint: only return when the bounded context fires.
		<-ctx.Done()
		return metrics.ScrapeResult{}
	})

	sup := &mockSupervisor{statuses: []supervisor.ProcessInfo{runningStatus("hung", 9100)}}

	done := make(chan struct{})
	go func() {
		buildHeartbeat(context.Background(), sup, newTestMetrics(), "0.54.0", "STANDALONE", nil, nil, "u")
		close(done)
	}()

	// heartbeatScrapeTimeout bounds the scrape; assembly must finish soon after.
	select {
	case <-done:
		// pass
	case <-time.After(heartbeatScrapeTimeout + 2*time.Second):
		t.Fatal("buildHeartbeat blocked on a hung scrape past the bounded timeout")
	}
}

// TestBuildHeartbeatScrapeCancelledByParent verifies that cancelling the parent
// context (e.g. agent shutdown) unblocks an in-flight scrape immediately,
// keeping shutdown responsive.
func TestBuildHeartbeatScrapeCancelledByParent(t *testing.T) {
	withScrapeFunc(t, func(ctx context.Context, port int) metrics.ScrapeResult {
		<-ctx.Done()
		return metrics.ScrapeResult{}
	})

	sup := &mockSupervisor{statuses: []supervisor.ProcessInfo{runningStatus("p", 9200)}}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		buildHeartbeat(ctx, sup, newTestMetrics(), "0.54.0", "STANDALONE", nil, nil, "u")
		close(done)
	}()

	// Cancel before the scrape timeout would fire; assembly must unblock at once.
	time.Sleep(20 * time.Millisecond)
	cancel()

	select {
	case <-done:
		// pass: parent cancellation propagated to the scrape
	case <-time.After(2 * time.Second):
		t.Fatal("buildHeartbeat did not return promptly after parent context was cancelled")
	}
}

// TestBuildHeartbeatScrapeResultsMappedPerPipeline verifies each pipeline gets
// its own scrape result wired into the right PipelineStatus.
func TestBuildHeartbeatScrapeResultsMappedPerPipeline(t *testing.T) {
	withScrapeFunc(t, func(ctx context.Context, port int) metrics.ScrapeResult {
		// Encode the port into EventsIn so we can assert correct mapping.
		return metrics.ScrapeResult{Pipeline: metrics.PipelineMetrics{EventsIn: int64(port)}}
	})

	sup := &mockSupervisor{statuses: []supervisor.ProcessInfo{
		runningStatus("p1", 9001),
		runningStatus("p2", 9002),
		{PipelineID: "p3-stopped", Status: "STOPPED", MetricsPort: 9003},
	}}

	hb := buildHeartbeat(context.Background(), sup, newTestMetrics(), "0.54.0", "STANDALONE", nil, nil, "u")
	if len(hb.Pipelines) != 3 {
		t.Fatalf("expected 3 pipelines, got %d", len(hb.Pipelines))
	}

	byID := map[string]int64{}
	for _, p := range hb.Pipelines {
		byID[p.PipelineID] = p.EventsIn
	}
	if byID["p1"] != 9001 {
		t.Errorf("p1 EventsIn: got %d, want 9001", byID["p1"])
	}
	if byID["p2"] != 9002 {
		t.Errorf("p2 EventsIn: got %d, want 9002", byID["p2"])
	}
	// Stopped pipeline must not be scraped.
	if byID["p3-stopped"] != 0 {
		t.Errorf("stopped pipeline should not be scraped, got EventsIn=%d", byID["p3-stopped"])
	}
}
