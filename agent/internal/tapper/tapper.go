package tapper

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"sync"
	"time"
)

// TapResult is a batch of tap events sent back to the server.
type TapResult struct {
	RequestID   string        `json:"requestId"`
	PipelineID  string        `json:"pipelineId"`
	ComponentID string        `json:"componentId"`
	Events      []interface{} `json:"events,omitempty"`
	Status      string        `json:"status,omitempty"`
	Reason      string        `json:"reason,omitempty"`
}

// SendFunc is the callback used to deliver tap event batches to the server.
type SendFunc func(result TapResult) error

// activeTap tracks a running tap subprocess.
type activeTap struct {
	cancel context.CancelFunc
	done   chan struct{}
}

// Manager manages concurrent long-lived `vector tap` subprocesses.
type Manager struct {
	vectorBin string
	mu        sync.Mutex
	active    map[string]*activeTap
}

const (
	maxConcurrentTaps = 3
	tapTimeout        = 5 * time.Minute
	flushInterval     = 1 * time.Second
	maxBatchSize      = 20
)

// New creates a new tap Manager.
func New(vectorBin string) *Manager {
	return &Manager{
		vectorBin: vectorBin,
		active:    make(map[string]*activeTap),
	}
}

// Start launches a long-lived `vector tap` subprocess for the given component.
// Returns an error if the maximum number of concurrent taps is exceeded or a tap
// with the same requestID is already running.
func (m *Manager) Start(requestID, pipelineID, componentID string, apiPort int, send SendFunc) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.active[requestID]; exists {
		return fmt.Errorf("tap %s already running", requestID)
	}
	if len(m.active) >= maxConcurrentTaps {
		return fmt.Errorf("maximum concurrent taps (%d) reached", maxConcurrentTaps)
	}

	ctx, cancel := context.WithTimeout(context.Background(), tapTimeout)
	done := make(chan struct{})

	m.active[requestID] = &activeTap{cancel: cancel, done: done}

	go m.run(ctx, done, requestID, pipelineID, componentID, apiPort, send)

	return nil
}

// Stop cancels a running tap and waits for it to finish.
func (m *Manager) Stop(requestID string) {
	m.mu.Lock()
	tap, exists := m.active[requestID]
	m.mu.Unlock()

	if !exists {
		return
	}

	tap.cancel()
	<-tap.done

	m.mu.Lock()
	delete(m.active, requestID)
	m.mu.Unlock()
}

// StopAll cancels all running taps and waits for them to finish.
func (m *Manager) StopAll() {
	m.mu.Lock()
	taps := make(map[string]*activeTap, len(m.active))
	for id, t := range m.active {
		taps[id] = t
	}
	m.mu.Unlock()

	for _, t := range taps {
		t.cancel()
	}
	for _, t := range taps {
		<-t.done
	}

	m.mu.Lock()
	m.active = make(map[string]*activeTap)
	m.mu.Unlock()
}

// run is the main goroutine for a single tap subprocess.
func (m *Manager) run(ctx context.Context, done chan struct{}, requestID, pipelineID, componentID string, apiPort int, send SendFunc) {
	defer func() {
		close(done)
		m.mu.Lock()
		delete(m.active, requestID)
		m.mu.Unlock()
	}()

	url := fmt.Sprintf("http://127.0.0.1:%d/graphql", apiPort)

	cmd := exec.CommandContext(ctx, m.vectorBin, "tap",
		"--outputs-of", componentID,
		"--url", url,
		"--format", "json",
		"--interval", "500",
		"--limit", "50",
		"--quiet",
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		slog.Error("tap: failed to create stdout pipe", "requestId", requestID, "error", err)
		sendStopped(send, requestID, pipelineID, componentID, fmt.Sprintf("stdout pipe: %v", err))
		return
	}

	if err := cmd.Start(); err != nil {
		slog.Error("tap: failed to start vector tap", "requestId", requestID, "error", err)
		sendStopped(send, requestID, pipelineID, componentID, fmt.Sprintf("start: %v", err))
		return
	}

	slog.Info("tap: started", "requestId", requestID, "component", componentID, "pid", cmd.Process.Pid)

	// Read stdout lines into a channel from a dedicated goroutine.
	lines := make(chan string, 64)
	go func() {
		defer close(lines)
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
	}()

	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()

	var batch []interface{}

	for {
		select {
		case line, ok := <-lines:
			if !ok {
				// Scanner finished — process exited.
				if len(batch) > 0 {
					flushBatch(send, requestID, pipelineID, componentID, batch)
				}
				_ = cmd.Wait()
				slog.Info("tap: process exited", "requestId", requestID)
				sendStopped(send, requestID, pipelineID, componentID, "process exited")
				return
			}

			var parsed interface{}
			if err := json.Unmarshal([]byte(line), &parsed); err != nil {
				continue // skip non-JSON lines
			}
			batch = append(batch, parsed)

			if len(batch) >= maxBatchSize {
				flushBatch(send, requestID, pipelineID, componentID, batch)
				batch = nil
			}

		case <-ticker.C:
			if len(batch) > 0 {
				flushBatch(send, requestID, pipelineID, componentID, batch)
				batch = nil
			}

		case <-ctx.Done():
			slog.Info("tap: context cancelled", "requestId", requestID)
			// Kill the process — CommandContext handles this automatically,
			// but we still wait for cleanup.
			_ = cmd.Wait()
			if len(batch) > 0 {
				flushBatch(send, requestID, pipelineID, componentID, batch)
			}
			sendStopped(send, requestID, pipelineID, componentID, "cancelled")
			return
		}
	}
}

// flushBatch sends a batch of events via the send callback.
func flushBatch(send SendFunc, requestID, pipelineID, componentID string, events []interface{}) {
	result := TapResult{
		RequestID:   requestID,
		PipelineID:  pipelineID,
		ComponentID: componentID,
		Events:      events,
	}
	if err := send(result); err != nil {
		slog.Warn("tap: failed to send batch", "requestId", requestID, "events", len(events), "error", err)
	}
}

// sendStopped sends a final "stopped" result to the server.
func sendStopped(send SendFunc, requestID, pipelineID, componentID, reason string) {
	result := TapResult{
		RequestID:   requestID,
		PipelineID:  pipelineID,
		ComponentID: componentID,
		Status:      "stopped",
		Reason:      reason,
	}
	if err := send(result); err != nil {
		slog.Warn("tap: failed to send stopped result", "requestId", requestID, "error", err)
	}
}
