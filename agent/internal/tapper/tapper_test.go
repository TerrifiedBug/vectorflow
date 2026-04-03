package tapper

import (
	"context"
	"fmt"
	"io"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// mockProcess implements tapProcess for controlled unit testing. It uses an
// io.Pipe to simulate the subprocess's stdout and responds to context
// cancellation in Wait() by closing the write end of the pipe, which propagates
// EOF to the scanner goroutine.
type mockProcess struct {
	ctx      context.Context
	pr       *io.PipeReader
	pw       *io.PipeWriter
	startErr error
	exited   chan struct{} // closed by exit() to signal normal process exit
	once     sync.Once    // ensures the pipe writer is closed exactly once
}

func newMockProcess(ctx context.Context, startErr error) *mockProcess {
	pr, pw := io.Pipe()
	return &mockProcess{
		ctx:      ctx,
		pr:       pr,
		pw:       pw,
		startErr: startErr,
		exited:   make(chan struct{}),
	}
}

func (mp *mockProcess) StdoutPipe() (io.ReadCloser, error) {
	return mp.pr, nil
}

func (mp *mockProcess) Start() error {
	if mp.startErr != nil {
		mp.pw.Close() // unblock any pending reader
		return mp.startErr
	}
	return nil
}

// Wait blocks until the process exits normally (via exit()) or is killed via
// context cancellation. On cancellation, it closes the pipe writer so the
// scanner goroutine reading from stdout sees EOF and exits cleanly.
func (mp *mockProcess) Wait() error {
	select {
	case <-mp.exited:
		return nil
	case <-mp.ctx.Done():
		mp.once.Do(func() { mp.pw.CloseWithError(mp.ctx.Err()) })
		return nil
	}
}

// sendLine writes a line to the mock process stdout (simulating vector tap output).
func (mp *mockProcess) sendLine(line string) {
	fmt.Fprintln(mp.pw, line)
}

// exit simulates the process exiting normally by closing stdout and unblocking Wait.
func (mp *mockProcess) exit() {
	mp.once.Do(func() { mp.pw.Close() })
	close(mp.exited)
}

// newFactory returns a newProcess factory function and a buffered channel that
// receives each mockProcess as it is created. Tests receive from the channel to
// get a handle to the running process for interaction.
func newFactory(startErr error) (func(context.Context, string, string) tapProcess, chan *mockProcess) {
	ch := make(chan *mockProcess, 16)
	factory := func(ctx context.Context, url, componentID string) tapProcess {
		mp := newMockProcess(ctx, startErr)
		ch <- mp
		return mp
	}
	return factory, ch
}

// noopSend discards all results.
func noopSend(_ TapResult) error { return nil }

// collectSend returns a send callback and a channel that receives each result.
func collectSend() (SendFunc, chan TapResult) {
	ch := make(chan TapResult, 32)
	return func(r TapResult) error {
		ch <- r
		return nil
	}, ch
}

// newTestManager creates a Manager wired with the mock factory.
func newTestManager(startErr error) (*Manager, chan *mockProcess) {
	factory, procs := newFactory(startErr)
	m := New("vector")
	m.newProcess = factory
	return m, procs
}

// drainProcs reads any remaining items from the factory channel so goroutines
// blocked on the channel send do not leak after a test.
func drainProcs(ch chan *mockProcess) {
	for {
		select {
		case <-ch:
		default:
			return
		}
	}
}

// TestStart_DuplicateRequestID verifies that starting a second tap with the same
// requestID returns an error while the first is still running.
func TestStart_DuplicateRequestID(t *testing.T) {
	m, procs := newTestManager(nil)
	t.Cleanup(func() { m.StopAll(); drainProcs(procs) })

	if err := m.Start("req1", "pipe1", "comp1", 8686, noopSend); err != nil {
		t.Fatalf("first Start() error: %v", err)
	}

	err := m.Start("req1", "pipe1", "comp1", 8686, noopSend)
	if err == nil {
		t.Fatal("expected error for duplicate requestID, got nil")
	}
	if !strings.Contains(err.Error(), "already running") {
		t.Errorf("unexpected error message: %v", err)
	}
}

// TestStart_MaxConcurrentTaps verifies that starting a tap beyond the concurrent
// limit fails immediately.
func TestStart_MaxConcurrentTaps(t *testing.T) {
	m, procs := newTestManager(nil)
	t.Cleanup(func() { m.StopAll(); drainProcs(procs) })

	for i := 0; i < maxConcurrentTaps; i++ {
		if err := m.Start(fmt.Sprintf("req%d", i), "pipe1", "comp1", 8686, noopSend); err != nil {
			t.Fatalf("Start(%d) unexpected error: %v", i, err)
		}
	}

	err := m.Start("req-extra", "pipe1", "comp1", 8686, noopSend)
	if err == nil {
		t.Fatal("expected error when at max concurrent taps, got nil")
	}
	if !strings.Contains(err.Error(), "maximum concurrent taps") {
		t.Errorf("unexpected error message: %v", err)
	}
}

// TestStop_CleansUp verifies that Stop removes the tap from the active map so
// the same requestID can be reused.
func TestStop_CleansUp(t *testing.T) {
	m, procs := newTestManager(nil)
	t.Cleanup(func() { m.StopAll(); drainProcs(procs) })

	if err := m.Start("req1", "pipe1", "comp1", 8686, noopSend); err != nil {
		t.Fatal(err)
	}

	// Stop blocks until the run and scanner goroutines have both exited.
	m.Stop("req1")

	// Should be able to reuse the requestID after a clean stop.
	if err := m.Start("req1", "pipe1", "comp1", 8686, noopSend); err != nil {
		t.Fatalf("Start after Stop returned error: %v", err)
	}
}

// TestStopAll_AllCleaned verifies that StopAll removes all active taps so their
// requestIDs can be reused.
func TestStopAll_AllCleaned(t *testing.T) {
	m, procs := newTestManager(nil)
	t.Cleanup(func() { m.StopAll(); drainProcs(procs) })

	for i := 0; i < 3; i++ {
		if err := m.Start(fmt.Sprintf("req%d", i), "pipe1", "comp1", 8686, noopSend); err != nil {
			t.Fatalf("Start(%d) error: %v", i, err)
		}
	}

	m.StopAll()

	for i := 0; i < 3; i++ {
		if err := m.Start(fmt.Sprintf("req%d", i), "pipe1", "comp1", 8686, noopSend); err != nil {
			t.Fatalf("Start after StopAll returned error for req%d: %v", i, err)
		}
	}
}

// TestLineForwarding_FlushOnProcessExit verifies that JSON lines emitted by the
// process are forwarded to the send callback when the process exits.
func TestLineForwarding_FlushOnProcessExit(t *testing.T) {
	m, procs := newTestManager(nil)
	t.Cleanup(func() { m.StopAll(); drainProcs(procs) })

	send, results := collectSend()
	if err := m.Start("req1", "pipe1", "comp1", 8686, send); err != nil {
		t.Fatal(err)
	}

	proc := <-procs
	proc.sendLine(`{"event": 1}`)
	proc.sendLine(`{"event": 2}`)
	proc.exit()

	var totalEvents int
	for {
		select {
		case r := <-results:
			totalEvents += len(r.Events)
			if r.Status == "stopped" {
				if totalEvents != 2 {
					t.Errorf("expected 2 events forwarded, got %d", totalEvents)
				}
				return
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timeout; received %d events so far", totalEvents)
		}
	}
}

// TestNonJSONLinesSkipped verifies that lines that do not parse as JSON are
// silently dropped and do not appear in the events batch.
func TestNonJSONLinesSkipped(t *testing.T) {
	m, procs := newTestManager(nil)
	t.Cleanup(func() { m.StopAll(); drainProcs(procs) })

	send, results := collectSend()
	if err := m.Start("req1", "pipe1", "comp1", 8686, send); err != nil {
		t.Fatal(err)
	}

	proc := <-procs
	proc.sendLine("not json at all")
	proc.sendLine("also: not: json")
	proc.sendLine(`{"valid": true}`)
	proc.exit()

	var totalEvents int
	for {
		select {
		case r := <-results:
			totalEvents += len(r.Events)
			if r.Status == "stopped" {
				if totalEvents != 1 {
					t.Errorf("expected 1 event (non-JSON lines skipped), got %d", totalEvents)
				}
				return
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timeout")
		}
	}
}

// TestBatchSizeFlush verifies that a mid-stream flush occurs when the batch
// reaches maxBatchSize, without waiting for the ticker or process exit.
func TestBatchSizeFlush(t *testing.T) {
	m, procs := newTestManager(nil)
	t.Cleanup(func() { m.StopAll(); drainProcs(procs) })

	send, results := collectSend()
	if err := m.Start("req1", "pipe1", "comp1", 8686, send); err != nil {
		t.Fatal(err)
	}

	proc := <-procs

	// maxBatchSize+1 lines: the first maxBatchSize trigger a mid-stream flush,
	// the remaining 1 is flushed on process exit.
	for i := 0; i < maxBatchSize+1; i++ {
		proc.sendLine(fmt.Sprintf(`{"i":%d}`, i))
	}
	proc.exit()

	var batchCalls int
	var totalEvents int
	for {
		select {
		case r := <-results:
			if len(r.Events) > 0 {
				batchCalls++
				totalEvents += len(r.Events)
			}
			if r.Status == "stopped" {
				if batchCalls < 2 {
					t.Errorf("expected >=2 batch flushes (mid-stream + exit), got %d", batchCalls)
				}
				if totalEvents != maxBatchSize+1 {
					t.Errorf("expected %d total events, got %d", maxBatchSize+1, totalEvents)
				}
				return
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timeout; batchCalls=%d totalEvents=%d", batchCalls, totalEvents)
		}
	}
}

// TestProcessExit_SendsStopped verifies that a naturally exiting process causes
// a "stopped" result with the correct requestID and pipelineID.
func TestProcessExit_SendsStopped(t *testing.T) {
	m, procs := newTestManager(nil)
	t.Cleanup(func() { m.StopAll(); drainProcs(procs) })

	send, results := collectSend()
	if err := m.Start("req1", "pipe1", "comp1", 8686, send); err != nil {
		t.Fatal(err)
	}

	proc := <-procs
	proc.exit()

	// Drain non-stopped results until we see the stopped one.
	for {
		select {
		case r := <-results:
			if r.Status == "stopped" {
				if r.RequestID != "req1" {
					t.Errorf("requestId: got %q, want %q", r.RequestID, "req1")
				}
				if r.PipelineID != "pipe1" {
					t.Errorf("pipelineId: got %q, want %q", r.PipelineID, "pipe1")
				}
				return
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timeout waiting for stopped result")
		}
	}
}

// TestStartError_SendsStopped verifies that a subprocess that fails to start
// sends a "stopped" result without leaking goroutines.
func TestStartError_SendsStopped(t *testing.T) {
	m, _ := newTestManager(fmt.Errorf("exec: no such file"))
	t.Cleanup(func() { m.StopAll() })

	send, results := collectSend()

	// Start() itself should succeed — it just schedules the goroutine.
	if err := m.Start("req1", "pipe1", "comp1", 8686, send); err != nil {
		t.Fatalf("Start() returned unexpected error: %v", err)
	}

	select {
	case r := <-results:
		if r.Status != "stopped" {
			t.Errorf("expected status 'stopped', got %q", r.Status)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for stopped result after start failure")
	}
}

// TestContextCancellation_NoGoroutineLeak verifies that cancelling a tap (via
// Stop) causes both the run goroutine and the scanner goroutine to exit cleanly,
// leaving no goroutine leak.
//
// Correctness argument: Stop() blocks on <-tap.done, which is closed in run()'s
// defer. That defer executes only after "for range lines {}" completes, which
// requires the scanner goroutine to have called close(lines). Therefore, when
// Stop() returns, both goroutines have exited.
func TestContextCancellation_NoGoroutineLeak(t *testing.T) {
	m, procs := newTestManager(nil)
	t.Cleanup(func() { m.StopAll(); drainProcs(procs) })

	if err := m.Start("req1", "pipe1", "comp1", 8686, noopSend); err != nil {
		t.Fatal(err)
	}

	// Wait for the process to be created and the scanner goroutine to start.
	proc := <-procs
	_ = proc
	time.Sleep(50 * time.Millisecond)

	before := runtime.NumGoroutine()

	// Stop cancels the context and waits for all tap goroutines to exit.
	m.Stop("req1")

	// Brief pause for the scheduler to fully deschedule the exited goroutines.
	time.Sleep(20 * time.Millisecond)

	after := runtime.NumGoroutine()

	// We expect the goroutine count to decrease (at minimum the run and scanner
	// goroutines should be gone).
	if after >= before {
		t.Errorf("goroutine leak: before-stop=%d after-stop=%d; expected count to decrease",
			before, after)
	}
}

// TestConcurrentTaps_Independence verifies that multiple taps running
// concurrently do not interfere with each other's events.
func TestConcurrentTaps_Independence(t *testing.T) {
	m, procs := newTestManager(nil)
	t.Cleanup(func() { m.StopAll(); drainProcs(procs) })

	send1, results1 := collectSend()
	send2, results2 := collectSend()

	if err := m.Start("req1", "pipe1", "comp1", 8686, send1); err != nil {
		t.Fatal(err)
	}
	if err := m.Start("req2", "pipe2", "comp2", 8686, send2); err != nil {
		t.Fatal(err)
	}

	proc1 := <-procs
	proc2 := <-procs

	proc1.sendLine(`{"tap": "one"}`)
	proc1.exit()

	proc2.sendLine(`{"tap": "two"}`)
	proc2.exit()

	// Both taps should each deliver their own events independently.
	waitForStopped := func(name string, ch chan TapResult) {
		for {
			select {
			case r := <-ch:
				if r.Status == "stopped" {
					return
				}
			case <-time.After(2 * time.Second):
				t.Errorf("timeout waiting for %s stopped", name)
				return
			}
		}
	}
	waitForStopped("req1", results1)
	waitForStopped("req2", results2)
}
