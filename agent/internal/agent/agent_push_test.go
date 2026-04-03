package agent

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/TerrifiedBug/vectorflow/agent/internal/push"
	"github.com/TerrifiedBug/vectorflow/agent/internal/supervisor"
	"github.com/TerrifiedBug/vectorflow/agent/internal/tapper"
)

// mockSupervisor implements pipelineSupervisor for unit testing.
// All mutating methods record calls; Statuses() returns a configurable slice.
type mockSupervisor struct {
	mu sync.Mutex

	restartInPlaceCalled string
	restartInPlaceErr    error

	statuses []supervisor.ProcessInfo
}

func (m *mockSupervisor) RestartInPlace(pipelineID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.restartInPlaceCalled = pipelineID
	return m.restartInPlaceErr
}

func (m *mockSupervisor) Start(pipelineID, configPath string, version int, logLevel string, secrets map[string]string) error {
	return nil
}
func (m *mockSupervisor) Stop(pipelineID string) error { return nil }
func (m *mockSupervisor) Restart(pipelineID, configPath string, version int, logLevel string, secrets map[string]string) error {
	return nil
}
func (m *mockSupervisor) UpdateVersion(pipelineID string, version int)     {}
func (m *mockSupervisor) SetConfigChecksum(pipelineID, checksum string)    {}
func (m *mockSupervisor) GetRecentLogs(pipelineID string) []string         { return nil }
func (m *mockSupervisor) ShutdownAll()                                     {}
func (m *mockSupervisor) Statuses() []supervisor.ProcessInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]supervisor.ProcessInfo(nil), m.statuses...)
}

// newTestAgent builds a minimal Agent suitable for push-handler unit tests.
func newTestAgent(sup pipelineSupervisor) *Agent {
	return &Agent{
		supervisor:           sup,
		tapManager:           tapper.New("vector"),
		immediateHeartbeatCh: make(chan struct{}, 1),
	}
}

// TestHandlePushRestartCallsRestartInPlace verifies that a push action=restart
// message calls RestartInPlace with the correct pipelineID.
func TestHandlePushRestartCallsRestartInPlace(t *testing.T) {
	sup := &mockSupervisor{}
	a := newTestAgent(sup)

	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	a.handlePushMessage(push.PushMessage{
		Type:       "action",
		Action:     "restart",
		PipelineID: "pipeline-abc",
	}, ticker)

	sup.mu.Lock()
	called := sup.restartInPlaceCalled
	sup.mu.Unlock()

	if called != "pipeline-abc" {
		t.Errorf("expected RestartInPlace called with %q, got %q", "pipeline-abc", called)
	}
}

// TestHandlePushRestartTriggersHeartbeat verifies that a restart action always
// queues an immediate heartbeat, regardless of whether restart succeeded.
func TestHandlePushRestartTriggersHeartbeat(t *testing.T) {
	sup := &mockSupervisor{}
	a := newTestAgent(sup)

	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	a.handlePushMessage(push.PushMessage{
		Type:       "action",
		Action:     "restart",
		PipelineID: "pipeline-abc",
	}, ticker)

	// The immediate heartbeat is delivered via a 1s timer; wait up to 2s.
	select {
	case <-a.immediateHeartbeatCh:
		// pass
	case <-time.After(2 * time.Second):
		t.Error("expected heartbeat signal within 2s, none received")
	}
}

// TestHandlePushRestartErrorStillHeartbeats verifies that a failed restart
// still triggers the heartbeat so the server learns the pipeline state.
func TestHandlePushRestartErrorStillHeartbeats(t *testing.T) {
	sup := &mockSupervisor{
		restartInPlaceErr: fmt.Errorf("process not found"),
	}
	a := newTestAgent(sup)

	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	a.handlePushMessage(push.PushMessage{
		Type:       "action",
		Action:     "restart",
		PipelineID: "missing-pipeline",
	}, ticker)

	select {
	case <-a.immediateHeartbeatCh:
		// pass
	case <-time.After(2 * time.Second):
		t.Error("expected heartbeat signal within 2s even after error")
	}
}

// TestHandlePushRestartMissingPipelineID verifies that a restart message
// with no pipelineId is ignored without calling RestartInPlace.
func TestHandlePushRestartMissingPipelineID(t *testing.T) {
	sup := &mockSupervisor{}
	a := newTestAgent(sup)

	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	a.handlePushMessage(push.PushMessage{
		Type:   "action",
		Action: "restart",
		// PipelineID intentionally empty
	}, ticker)

	sup.mu.Lock()
	called := sup.restartInPlaceCalled
	sup.mu.Unlock()

	if called != "" {
		t.Errorf("expected RestartInPlace not called, but was called with %q", called)
	}
}
