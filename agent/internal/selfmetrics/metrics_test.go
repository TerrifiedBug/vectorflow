package selfmetrics

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// --- counter tests ---

func TestIncPollErrors(t *testing.T) {
	m := New(nil)
	if m.pollErrors.Load() != 0 {
		t.Fatal("expected initial poll errors = 0")
	}
	m.IncPollErrors()
	m.IncPollErrors()
	if got := m.pollErrors.Load(); got != 2 {
		t.Errorf("expected 2 poll errors, got %d", got)
	}
}

func TestIncPushReconnects(t *testing.T) {
	m := New(nil)
	m.IncPushReconnects()
	if got := m.pushReconnects.Load(); got != 1 {
		t.Errorf("expected 1 reconnect, got %d", got)
	}
}

func TestIncHeartbeatErrors(t *testing.T) {
	m := New(nil)
	m.IncHeartbeatErrors()
	m.IncHeartbeatErrors()
	m.IncHeartbeatErrors()
	if got := m.heartbeatErrors.Load(); got != 3 {
		t.Errorf("expected 3 heartbeat errors, got %d", got)
	}
}

// --- gauge tests ---

func TestSetPushConnected(t *testing.T) {
	m := New(nil)
	if m.pushConnected.Load() != 0 {
		t.Fatal("expected initial connected = 0")
	}
	m.SetPushConnected(true)
	if m.pushConnected.Load() != 1 {
		t.Error("expected connected = 1 after SetPushConnected(true)")
	}
	m.SetPushConnected(false)
	if m.pushConnected.Load() != 0 {
		t.Error("expected connected = 0 after SetPushConnected(false)")
	}
}

func TestObservePollDuration(t *testing.T) {
	m := New(nil)
	m.ObservePollDuration(250 * time.Millisecond)
	m.pollDurationMu.Lock()
	d := m.pollDuration
	m.pollDurationMu.Unlock()
	if d < 0.249 || d > 0.251 {
		t.Errorf("expected pollDuration ≈ 0.25s, got %f", d)
	}
}

func TestObserveHeartbeatDuration(t *testing.T) {
	m := New(nil)
	m.ObserveHeartbeatDuration(500 * time.Millisecond)
	m.heartbeatDurationMu.Lock()
	d := m.heartbeatDuration
	m.heartbeatDurationMu.Unlock()
	if d < 0.499 || d > 0.501 {
		t.Errorf("expected heartbeatDuration ≈ 0.5s, got %f", d)
	}
}

// --- snapshot tests ---

func TestSnap(t *testing.T) {
	m := New(func() int { return 3 })
	m.IncPollErrors()
	m.IncPushReconnects()
	m.IncPushReconnects()
	m.IncHeartbeatErrors()
	m.SetPushConnected(true)

	snap := m.Snap()
	if snap.PollErrorsTotal != 1 {
		t.Errorf("PollErrorsTotal: want 1, got %d", snap.PollErrorsTotal)
	}
	if snap.PushReconnectsTotal != 2 {
		t.Errorf("PushReconnectsTotal: want 2, got %d", snap.PushReconnectsTotal)
	}
	if snap.HeartbeatErrorsTotal != 1 {
		t.Errorf("HeartbeatErrorsTotal: want 1, got %d", snap.HeartbeatErrorsTotal)
	}
	if !snap.PushConnected {
		t.Error("PushConnected: want true")
	}
	if snap.PipelinesRunning != 3 {
		t.Errorf("PipelinesRunning: want 3, got %d", snap.PipelinesRunning)
	}
	if snap.UptimeSeconds < 0 {
		t.Errorf("UptimeSeconds should be non-negative, got %f", snap.UptimeSeconds)
	}
}

func TestSnapNilPipelinesRunning(t *testing.T) {
	m := New(nil) // nil pipelinesRunning → defaults to 0
	snap := m.Snap()
	if snap.PipelinesRunning != 0 {
		t.Errorf("want 0 pipelines running, got %d", snap.PipelinesRunning)
	}
}

// --- Prometheus HTTP handler tests ---

func TestHandlerReturnsPrometheusFormat(t *testing.T) {
	m := New(func() int { return 2 })
	m.IncPollErrors()
	m.IncPushReconnects()
	m.SetPushConnected(true)

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	w := httptest.NewRecorder()
	m.Handler().ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("expected text/plain content-type, got %q", ct)
	}

	body, _ := io.ReadAll(resp.Body)
	bodyStr := string(body)

	wantMetrics := []string{
		"vf_agent_poll_errors_total",
		"vf_agent_poll_duration_seconds",
		"vf_agent_push_reconnects_total",
		"vf_agent_push_connected",
		"vf_agent_heartbeat_errors_total",
		"vf_agent_heartbeat_duration_seconds",
		"vf_agent_pipelines_running",
		"vf_agent_uptime_seconds",
	}
	for _, name := range wantMetrics {
		if !strings.Contains(bodyStr, name) {
			t.Errorf("expected metric %q in response body", name)
		}
	}
}

func TestHandlerCounterValues(t *testing.T) {
	m := New(nil)
	m.IncPollErrors()
	m.IncPollErrors()
	m.IncPollErrors()

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	w := httptest.NewRecorder()
	m.Handler().ServeHTTP(w, req)

	body, _ := io.ReadAll(w.Result().Body)
	bodyStr := string(body)

	// The counter line should contain the metric name followed by " 3"
	if !strings.Contains(bodyStr, "vf_agent_poll_errors_total 3") {
		t.Errorf("expected 'vf_agent_poll_errors_total 3' in body:\n%s", bodyStr)
	}
}

func TestHandlerTypeAnnotations(t *testing.T) {
	m := New(nil)
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	w := httptest.NewRecorder()
	m.Handler().ServeHTTP(w, req)

	body, _ := io.ReadAll(w.Result().Body)
	bodyStr := string(body)

	wantTypes := []string{
		"# TYPE vf_agent_poll_errors_total counter",
		"# TYPE vf_agent_push_connected gauge",
		"# TYPE vf_agent_uptime_seconds gauge",
	}
	for _, line := range wantTypes {
		if !strings.Contains(bodyStr, line) {
			t.Errorf("expected type annotation %q in body:\n%s", line, bodyStr)
		}
	}
}

// --- concurrency safety test ---

func TestConcurrentUpdates(t *testing.T) {
	m := New(func() int { return 1 })

	const goroutines = 50
	done := make(chan struct{})
	for i := 0; i < goroutines; i++ {
		go func() {
			m.IncPollErrors()
			m.IncPushReconnects()
			m.IncHeartbeatErrors()
			m.SetPushConnected(i%2 == 0)
			m.ObservePollDuration(time.Millisecond)
			m.ObserveHeartbeatDuration(time.Millisecond)
			_ = m.Snap()
			done <- struct{}{}
		}()
	}
	for i := 0; i < goroutines; i++ {
		<-done
	}

	snap := m.Snap()
	if snap.PollErrorsTotal != goroutines {
		t.Errorf("expected %d poll errors, got %d", goroutines, snap.PollErrorsTotal)
	}
}
