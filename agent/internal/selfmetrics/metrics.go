// Package selfmetrics tracks internal health metrics of the vf-agent process itself
// (distinct from agent/internal/metrics, which scrapes Vector pipeline metrics).
// Counters and gauges are implemented with sync/atomic; the Prometheus text format
// is emitted by a minimal hand-written serialiser so the agent stays stdlib-only.
package selfmetrics

import (
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// Metrics holds all self-monitoring state for the agent.
// Obtain one with New and call its methods from any goroutine — all operations
// are goroutine-safe.
type Metrics struct {
	startTime time.Time

	// Counters — monotonically increasing, reset only on process restart.
	pollErrors      atomic.Int64
	pushReconnects  atomic.Int64
	heartbeatErrors atomic.Int64

	// Gauges
	pushConnected atomic.Int32 // 1 = connected, 0 = disconnected

	// Last-observed duration gauges (protected by their own mutexes so that
	// float64 writes are safe on 32-bit platforms).
	pollDurationMu    sync.Mutex
	pollDuration      float64 // seconds

	heartbeatDurationMu sync.Mutex
	heartbeatDuration   float64 // seconds

	// Dynamic gauge: delegate to the agent so we don't need a copy.
	pipelinesRunning func() int
}

// New creates a Metrics instance. pipelinesRunning is called on every /metrics
// scrape to report the current count of running pipelines; pass nil to always
// report 0.
func New(pipelinesRunning func() int) *Metrics {
	if pipelinesRunning == nil {
		pipelinesRunning = func() int { return 0 }
	}
	return &Metrics{
		startTime:        time.Now(),
		pipelinesRunning: pipelinesRunning,
	}
}

// --- Recording helpers (called from agent internals) ---

// IncPollErrors increments the poll-error counter by one.
func (m *Metrics) IncPollErrors() { m.pollErrors.Add(1) }

// IncPushReconnects increments the SSE reconnect counter by one.
func (m *Metrics) IncPushReconnects() { m.pushReconnects.Add(1) }

// IncHeartbeatErrors increments the heartbeat-error counter by one.
func (m *Metrics) IncHeartbeatErrors() { m.heartbeatErrors.Add(1) }

// SetPushConnected sets the push-connected gauge (true = 1, false = 0).
func (m *Metrics) SetPushConnected(v bool) {
	if v {
		m.pushConnected.Store(1)
	} else {
		m.pushConnected.Store(0)
	}
}

// ObservePollDuration records the duration of a poll cycle.
func (m *Metrics) ObservePollDuration(d time.Duration) {
	m.pollDurationMu.Lock()
	m.pollDuration = d.Seconds()
	m.pollDurationMu.Unlock()
}

// ObserveHeartbeatDuration records the duration of a heartbeat send.
func (m *Metrics) ObserveHeartbeatDuration(d time.Duration) {
	m.heartbeatDurationMu.Lock()
	m.heartbeatDuration = d.Seconds()
	m.heartbeatDurationMu.Unlock()
}

// --- Snapshot for heartbeat payload ---

// Snapshot holds a point-in-time copy of the agent's health metrics,
// suitable for embedding in the heartbeat payload.
type Snapshot struct {
	PollErrorsTotal      int64   `json:"pollErrorsTotal"`
	PushReconnectsTotal  int64   `json:"pushReconnectsTotal"`
	HeartbeatErrorsTotal int64   `json:"heartbeatErrorsTotal"`
	PushConnected        bool    `json:"pushConnected"`
	PipelinesRunning     int     `json:"pipelinesRunning"`
	UptimeSeconds        float64 `json:"uptimeSeconds"`
}

// Snap returns a consistent read of all agent metrics at this instant.
// All fields use atomic operations; no mutex is required here.
func (m *Metrics) Snap() Snapshot {
	return Snapshot{
		PollErrorsTotal:      m.pollErrors.Load(),
		PushReconnectsTotal:  m.pushReconnects.Load(),
		HeartbeatErrorsTotal: m.heartbeatErrors.Load(),
		PushConnected:        m.pushConnected.Load() == 1,
		PipelinesRunning:     m.pipelinesRunning(),
		UptimeSeconds:        time.Since(m.startTime).Seconds(),
	}
}

// --- Prometheus HTTP handler ---

// Handler returns an http.Handler that serves agent self-metrics in
// Prometheus text exposition format (version 0.0.4).
func (m *Metrics) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		m.pollDurationMu.Lock()
		pd := m.pollDuration
		m.pollDurationMu.Unlock()

		m.heartbeatDurationMu.Lock()
		hd := m.heartbeatDuration
		m.heartbeatDurationMu.Unlock()

		connected := m.pushConnected.Load()
		uptime := time.Since(m.startTime).Seconds()
		running := m.pipelinesRunning()

		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

		writeCounter(w, "vf_agent_poll_errors_total",
			"Total number of failed poll requests to the VectorFlow server.",
			m.pollErrors.Load())

		writeGauge(w, "vf_agent_poll_duration_seconds",
			"Duration of the most recent poll cycle in seconds.",
			pd)

		writeCounter(w, "vf_agent_push_reconnects_total",
			"Total number of SSE push-channel reconnection events.",
			m.pushReconnects.Load())

		writeGauge(w, "vf_agent_push_connected",
			"1 if the agent is currently connected to the SSE push channel, 0 otherwise.",
			float64(connected))

		writeCounter(w, "vf_agent_heartbeat_errors_total",
			"Total number of failed heartbeat sends.",
			m.heartbeatErrors.Load())

		writeGauge(w, "vf_agent_heartbeat_duration_seconds",
			"Duration of the most recent heartbeat send in seconds.",
			hd)

		writeGauge(w, "vf_agent_pipelines_running",
			"Number of Vector pipelines currently in the RUNNING state.",
			float64(running))

		writeGauge(w, "vf_agent_uptime_seconds",
			"Number of seconds the agent process has been running.",
			uptime)
	})
}

// Serve starts a blocking HTTP server on the given port exposing /metrics.
// It is meant to be called in a dedicated goroutine.
func (m *Metrics) Serve(port int) error {
	mux := http.NewServeMux()
	mux.Handle("/metrics", m.Handler())
	addr := fmt.Sprintf(":%d", port)
	srv := &http.Server{
		Addr:    addr,
		Handler: mux,
	}
	return srv.ListenAndServe()
}

// --- text format helpers ---

func writeCounter(w http.ResponseWriter, name, help string, v int64) {
	fmt.Fprintf(w, "# HELP %s %s\n", name, help)
	fmt.Fprintf(w, "# TYPE %s counter\n", name)
	fmt.Fprintf(w, "%s %d\n", name, v)
}

func writeGauge(w http.ResponseWriter, name, help string, v float64) {
	fmt.Fprintf(w, "# HELP %s %s\n", name, help)
	fmt.Fprintf(w, "# TYPE %s gauge\n", name)
	fmt.Fprintf(w, "%s %g\n", name, v)
}
