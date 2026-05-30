package supervisor

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// mockProc implements supervisedProcess for controlled unit testing.
//
// Tests control when Wait() returns by calling exit() or by triggering Kill().
// Both exit() and Kill() use a sync.Once so exactly one value is ever delivered
// to the Wait() call — mirroring real OS process semantics where Wait returns
// exactly once.
//
// The stdout/stderr writers are stored so tests can simulate process log output
// flowing into the ring buffer.
type mockProc struct {
	pid    int
	stdout io.Writer
	stderr io.Writer

	startErr error

	mu      sync.Mutex
	signals []os.Signal
	killed  bool

	exitOnce sync.Once
	exitCh   chan error // buffered(1); exactly one value reaches Wait()
}

func (m *mockProc) Start() error {
	return m.startErr
}

// Wait blocks until exit() or Kill() is called.
func (m *mockProc) Wait() error {
	return <-m.exitCh
}

func (m *mockProc) Pid() int { return m.pid }

func (m *mockProc) Signal(sig os.Signal) error {
	m.mu.Lock()
	m.signals = append(m.signals, sig)
	m.mu.Unlock()
	return nil
}

// Kill records the kill and unblocks Wait(), mirroring real SIGKILL semantics.
func (m *mockProc) Kill() error {
	m.mu.Lock()
	m.killed = true
	m.mu.Unlock()
	m.exitOnce.Do(func() { m.exitCh <- errors.New("killed") })
	return nil
}

// exit makes Wait() return with err, simulating a normal process exit.
// If Kill() already fired, this is a no-op (sync.Once guard).
func (m *mockProc) exit(err error) {
	m.exitOnce.Do(func() { m.exitCh <- err })
}

// receivedSIGTERM reports whether SIGTERM was sent to this process.
func (m *mockProc) receivedSIGTERM() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, sig := range m.signals {
		if sig == syscall.SIGTERM {
			return true
		}
	}
	return false
}

// wasKilled reports whether Kill() was called.
func (m *mockProc) wasKilled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.killed
}

// newMockFactory returns a procFactory and a buffered channel that receives
// each *mockProc as it is created. Tests receive from the channel to interact
// with each process (send output, trigger exit, inspect signals).
func newMockFactory(startErr error) (procFactory, chan *mockProc) {
	ch := make(chan *mockProc, 16)
	pidSeq := 0
	factory := func(bin string, args, env []string, stdout, stderr io.Writer) supervisedProcess {
		pidSeq++
		mp := &mockProc{
			pid:      pidSeq * 1000,
			stdout:   stdout,
			stderr:   stderr,
			startErr: startErr,
			exitCh:   make(chan error, 1),
		}
		ch <- mp
		return mp
	}
	return factory, ch
}

// newTestSupervisor creates a Supervisor wired with a mock factory and
// near-zero timing so tests run fast without real sleep delays.
func newTestSupervisor(startErr error) (*Supervisor, chan *mockProc) {
	factory, procs := newMockFactory(startErr)
	s := New("/fake/vector")
	s.mkProc = factory
	s.startupDelay = 0
	s.backoffFunc = func(int) time.Duration { return 0 }
	s.stopTimeout = 50 * time.Millisecond
	return s, procs
}

// tempConfig creates a placeholder config file in a temp dir and returns its
// path. The directory is automatically cleaned up via t.TempDir().
func tempConfig(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "pipeline.yaml")
	if err := os.WriteFile(path, []byte("# placeholder"), 0600); err != nil {
		t.Fatalf("tempConfig WriteFile: %v", err)
	}
	return path
}

// drainProcs discards any remaining items from the factory channel so that
// goroutines blocked on channel send do not leak after a test completes.
func drainProcs(ch chan *mockProc) {
	for {
		select {
		case <-ch:
		default:
			return
		}
	}
}

// waitForStatus polls Statuses() until pipelineID reaches the given status
// or the timeout is exceeded.
func waitForStatus(t *testing.T, s *Supervisor, pipelineID, want string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		for _, st := range s.Statuses() {
			if st.PipelineID == pipelineID && st.Status == want {
				return
			}
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Errorf("timeout waiting for pipeline %q to reach status %q", pipelineID, want)
}

// ── Start tests ──────────────────────────────────────────────────────────────

// TestStart_Success verifies that a pipeline transitions STARTING → RUNNING
// after the (zero) startup delay, and that the PID is reflected correctly.
func TestStart_Success(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "info", nil); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	proc := <-procs
	if proc.Pid() != 1000 {
		t.Errorf("expected PID 1000, got %d", proc.Pid())
	}

	waitForStatus(t, s, "pipe1", "RUNNING", 500*time.Millisecond)
}

// TestStart_DuplicatePipeline verifies that starting the same pipeline twice
// returns an "already running" error.
func TestStart_DuplicatePipeline(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatalf("first Start() error: %v", err)
	}

	err := s.Start("pipe1", cfg, 1, "", nil)
	if err == nil {
		t.Fatal("expected error for duplicate pipeline, got nil")
	}
	if !strings.Contains(err.Error(), "already running") {
		t.Errorf("unexpected error message: %v", err)
	}
}

// TestStart_ProcStartError verifies that a process whose Start() fails returns
// an error and does not register the pipeline in the active map.
func TestStart_ProcStartError(t *testing.T) {
	s, procs := newTestSupervisor(errors.New("exec: no such file"))
	cfg := tempConfig(t)
	t.Cleanup(func() { drainProcs(procs) })

	err := s.Start("pipe1", cfg, 1, "", nil)
	if err == nil {
		t.Fatal("expected error when proc.Start() fails, got nil")
	}
	if !strings.Contains(err.Error(), "start vector") {
		t.Errorf("unexpected error message: %v", err)
	}

	if statuses := s.Statuses(); len(statuses) != 0 {
		t.Errorf("expected 0 active pipelines, got %d", len(statuses))
	}
}

// TestStart_PortsAllocated verifies that each new pipeline receives unique
// metrics and API port numbers.
func TestStart_PortsAllocated(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatalf("Start pipe1: %v", err)
	}
	if err := s.Start("pipe2", cfg, 1, "", nil); err != nil {
		t.Fatalf("Start pipe2: %v", err)
	}
	<-procs
	<-procs

	statuses := s.Statuses()
	if len(statuses) != 2 {
		t.Fatalf("expected 2 statuses, got %d", len(statuses))
	}

	ports := map[int]bool{}
	for _, st := range statuses {
		if ports[st.MetricsPort] {
			t.Errorf("duplicate MetricsPort %d", st.MetricsPort)
		}
		if ports[st.APIPort] {
			t.Errorf("duplicate APIPort %d", st.APIPort)
		}
		ports[st.MetricsPort] = true
		ports[st.APIPort] = true
	}
}

// TestPorts_ReusedAfterStop verifies that ports freed by a stopped pipeline are
// reused by the next start, so ports do not climb monotonically toward
// exhaustion as pipelines churn.
func TestPorts_ReusedAfterStop(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatalf("Start pipe1: %v", err)
	}
	proc1 := <-procs
	var firstMetrics, firstAPI int
	for _, st := range s.Statuses() {
		firstMetrics, firstAPI = st.MetricsPort, st.APIPort
	}

	// Stop pipe1 (respond to SIGTERM) — its ports return to the pool.
	go func() {
		for !proc1.receivedSIGTERM() {
			time.Sleep(1 * time.Millisecond)
		}
		proc1.exit(nil)
	}()
	if err := s.Stop("pipe1"); err != nil {
		t.Fatalf("Stop pipe1: %v", err)
	}

	// Start a fresh pipeline — it should reuse the freed ports rather than
	// allocating higher ones.
	if err := s.Start("pipe2", cfg, 1, "", nil); err != nil {
		t.Fatalf("Start pipe2: %v", err)
	}
	<-procs
	var secondMetrics, secondAPI int
	for _, st := range s.Statuses() {
		secondMetrics, secondAPI = st.MetricsPort, st.APIPort
	}

	reused := map[int]bool{firstMetrics: true, firstAPI: true}
	if !reused[secondMetrics] || !reused[secondAPI] {
		t.Errorf("expected pipe2 to reuse freed ports {%d,%d}, got {%d,%d}",
			firstMetrics, firstAPI, secondMetrics, secondAPI)
	}
}

// TestPorts_DoNotGrowMonotonically verifies that repeatedly starting and
// stopping pipelines does not advance the sequential allocator: the second
// start after a stop reuses ports rather than handing out higher numbers.
func TestPorts_DoNotGrowMonotonically(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	maxSeen := 0
	for i := 0; i < 50; i++ {
		if err := s.Start("pipe", cfg, 1, "", nil); err != nil {
			t.Fatalf("Start iteration %d: %v", i, err)
		}
		proc := <-procs
		for _, st := range s.Statuses() {
			if st.MetricsPort > maxSeen {
				maxSeen = st.MetricsPort
			}
			if st.APIPort > maxSeen {
				maxSeen = st.APIPort
			}
		}
		go func() {
			for !proc.receivedSIGTERM() {
				time.Sleep(time.Millisecond)
			}
			proc.exit(nil)
		}()
		if err := s.Stop("pipe"); err != nil {
			t.Fatalf("Stop iteration %d: %v", i, err)
		}
	}

	// Only one pipeline is ever live at a time, so at most two ports are in use.
	// With reuse, the highest port handed out must stay near basePort+2, not
	// climb with the iteration count.
	if maxSeen > s.basePort+10 {
		t.Errorf("ports grew monotonically: max port %d far above base %d after 50 churns",
			maxSeen, s.basePort)
	}
}

// TestPorts_ExhaustionReturnsError verifies that the allocator surfaces an error
// once the port range is exhausted rather than returning an invalid port.
func TestPorts_ExhaustionReturnsError(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	// Shrink the range so exhaustion is reachable: room for exactly one pair.
	s.nextSeqPort = s.maxPort - 1 // two ports available: maxPort-1, maxPort

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatalf("first Start should succeed: %v", err)
	}
	<-procs

	err := s.Start("pipe2", cfg, 1, "", nil)
	if err == nil {
		t.Fatal("expected port-exhaustion error on second Start, got nil")
	}
	if !strings.Contains(err.Error(), "no available ports") {
		t.Errorf("unexpected error: %v", err)
	}
	if statuses := s.Statuses(); len(statuses) != 1 {
		t.Errorf("expected only pipe1 active after exhaustion, got %d", len(statuses))
	}
}

// ── Stop tests ───────────────────────────────────────────────────────────────

// TestStop_GracefulShutdown verifies that Stop sends SIGTERM, waits for the
// process to exit, and removes it from the active map.
func TestStop_GracefulShutdown(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}
	proc := <-procs

	// Respond to SIGTERM by exiting cleanly.
	go func() {
		for !proc.receivedSIGTERM() {
			time.Sleep(1 * time.Millisecond)
		}
		proc.exit(nil)
	}()

	if err := s.Stop("pipe1"); err != nil {
		t.Fatalf("Stop() error: %v", err)
	}

	if !proc.receivedSIGTERM() {
		t.Error("expected SIGTERM to be sent")
	}
	if proc.wasKilled() {
		t.Error("expected no SIGKILL for graceful shutdown")
	}
	if statuses := s.Statuses(); len(statuses) != 0 {
		t.Errorf("expected 0 active pipelines after stop, got %d", len(statuses))
	}
}

// TestStop_KillAfterTimeout verifies that Stop escalates to SIGKILL when the
// process does not exit within the stop timeout window.
//
// With stopTimeout=50ms: stopProcess sends SIGTERM, waits 50ms, then calls
// Kill(). Our mockProc.Kill() unblocks Wait() (via exitOnce), so the stop
// completes promptly after the timeout.
func TestStop_KillAfterTimeout(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}
	proc := <-procs
	// proc ignores SIGTERM — Kill() will be required.

	if err := s.Stop("pipe1"); err != nil {
		t.Fatalf("Stop() error: %v", err)
	}

	if !proc.wasKilled() {
		t.Error("expected SIGKILL after timeout")
	}
}

// TestStop_NonExistent verifies that stopping a non-existent pipeline is a no-op.
func TestStop_NonExistent(t *testing.T) {
	s, _ := newTestSupervisor(nil)
	if err := s.Stop("does-not-exist"); err != nil {
		t.Errorf("expected nil error for non-existent pipeline, got: %v", err)
	}
}

// TestStop_RemovesFromActive verifies that after Stop the pipeline ID can be
// reused to start a new process.
func TestStop_RemovesFromActive(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}
	proc := <-procs
	proc.exit(nil) // let it exit cleanly

	// Allow monitor to process the clean exit.
	time.Sleep(20 * time.Millisecond)

	s.Stop("pipe1")

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatalf("Start after Stop returned error: %v", err)
	}
	proc2 := <-procs
	proc2.exit(nil)
}

// ── Crash and restart tests ──────────────────────────────────────────────────

// TestCrashAndRestart verifies that a process crash triggers an automatic
// restart with a fresh process.
func TestCrashAndRestart(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}

	proc1 := <-procs
	proc1.exit(errors.New("exit status 1"))

	// Monitor should spawn a replacement process.
	select {
	case proc2 := <-procs:
		if proc2.Pid() == proc1.Pid() {
			t.Errorf("restarted process has same PID as crashed one")
		}
		proc2.exit(nil) // clean exit to stop further restarts
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout: no restarted process appeared")
	}
}

// TestCrashStatus verifies that a crashed pipeline transitions to CRASHED status
// before the restart goroutine runs. A non-zero backoff is required so that the
// CRASHED state is observable between the crash and the replacement process
// being added back to the map.
func TestCrashStatus(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	// Use a short but non-zero backoff so the CRASHED status is observable.
	s.backoffFunc = func(int) time.Duration { return 100 * time.Millisecond }
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}

	proc1 := <-procs
	proc1.exit(errors.New("exit status 1"))

	waitForStatus(t, s, "pipe1", "CRASHED", 300*time.Millisecond)

	// Clean up the restarted proc.
	select {
	case proc2 := <-procs:
		proc2.exit(nil)
	case <-time.After(500 * time.Millisecond):
	}
}

// TestMultipleCrashRestarts verifies that the consecutive-crash counter
// accumulates across the chain of crashes so the exponential backoff actually
// escalates (1, 2, 3, ...) rather than resetting to 1 on every crash. The
// counter is persisted on the Supervisor, not the per-crash ProcessInfo.
func TestMultipleCrashRestarts(t *testing.T) {
	var (
		mu           sync.Mutex
		backoffCalls []int
	)

	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	// Force the "rapid crash" path: a huge stable threshold means no crash is
	// ever treated as a one-off, so the counter must escalate.
	s.stableThreshold = time.Hour
	s.backoffFunc = func(restarts int) time.Duration {
		mu.Lock()
		backoffCalls = append(backoffCalls, restarts)
		mu.Unlock()
		return 0
	}
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}

	const crashes = 3
	for i := 0; i < crashes; i++ {
		proc := <-procs
		proc.exit(errors.New("crash"))
	}

	// Drain the final restarted proc.
	select {
	case proc := <-procs:
		proc.exit(nil)
	case <-time.After(500 * time.Millisecond):
	}

	mu.Lock()
	got := append([]int(nil), backoffCalls...)
	mu.Unlock()

	if len(got) < crashes {
		t.Errorf("expected at least %d backoff calls, got %d: %v", crashes, len(got), got)
		return
	}
	// The counter accumulates: crash 1 → 1, crash 2 → 2, crash 3 → 3.
	for i := 0; i < crashes; i++ {
		if got[i] != i+1 {
			t.Errorf("backoff call %d: expected escalating restarts=%d, got %d (all: %v)", i, i+1, got[i], got)
		}
	}
}

// TestStableRunResetsBackoff verifies that a process which stayed up past the
// stable threshold has its consecutive-crash counter reset, so an occasional
// crash after a long healthy run does not inherit a high backoff.
func TestStableRunResetsBackoff(t *testing.T) {
	var (
		mu           sync.Mutex
		backoffCalls []int
	)

	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	// Zero threshold: every crash is treated as following a stable run, so the
	// counter resets to 0 then increments to 1 every time.
	s.stableThreshold = 0
	s.backoffFunc = func(restarts int) time.Duration {
		mu.Lock()
		backoffCalls = append(backoffCalls, restarts)
		mu.Unlock()
		return 0
	}
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}

	const crashes = 3
	for i := 0; i < crashes; i++ {
		proc := <-procs
		proc.exit(errors.New("crash"))
	}
	select {
	case proc := <-procs:
		proc.exit(nil)
	case <-time.After(500 * time.Millisecond):
	}

	mu.Lock()
	got := append([]int(nil), backoffCalls...)
	mu.Unlock()

	if len(got) < crashes {
		t.Errorf("expected at least %d backoff calls, got %d: %v", crashes, len(got), got)
		return
	}
	for i := 0; i < crashes; i++ {
		if got[i] != 1 {
			t.Errorf("backoff call %d: expected restarts=1 after a stable run, got %d (all: %v)", i, got[i], got)
		}
	}
}

// TestCrashLoopGivesUp verifies the circuit breaker: after maxRestarts rapid
// crashes the supervisor stops restarting and marks the pipeline CRASH_LOOP
// instead of thrashing forever.
func TestCrashLoopGivesUp(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	s.stableThreshold = time.Hour // every crash counts toward the loop
	s.maxRestarts = 3
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}

	// maxRestarts crashes each spawn a replacement (counts 1..3); the next
	// crash (count 4 > maxRestarts) trips the breaker and spawns nothing.
	for i := 0; i < s.maxRestarts+1; i++ {
		proc := <-procs
		proc.exit(errors.New("crash"))
	}

	waitForStatus(t, s, "pipe1", "CRASH_LOOP", time.Second)

	// No further process should be started after the breaker trips.
	select {
	case proc := <-procs:
		proc.exit(nil)
		t.Errorf("supervisor restarted a crash-looping pipeline past maxRestarts")
	case <-time.After(100 * time.Millisecond):
	}
}

// TestDefaultBackoff verifies the exponential backoff function with a cap at 60s.
func TestDefaultBackoff(t *testing.T) {
	cases := []struct {
		restarts int
		want     time.Duration
	}{
		{1, 1 * time.Second},
		{2, 2 * time.Second},
		{3, 4 * time.Second},
		{4, 8 * time.Second},
		{7, 60 * time.Second}, // 1<<6=64 → capped to 60
		{10, 60 * time.Second},
	}
	for _, tc := range cases {
		got := defaultBackoffFunc(tc.restarts)
		if got != tc.want {
			t.Errorf("defaultBackoffFunc(%d) = %v, want %v", tc.restarts, got, tc.want)
		}
	}
}

// TestCleanExit_NoRestart verifies that a process exiting cleanly (nil error)
// is marked STOPPED and not restarted.
func TestCleanExit_NoRestart(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}

	proc := <-procs
	proc.exit(nil)

	waitForStatus(t, s, "pipe1", "STOPPED", 300*time.Millisecond)

	// No new process should be spawned after a clean exit.
	select {
	case <-procs:
		t.Error("unexpected restart of cleanly exited process")
	case <-time.After(100 * time.Millisecond):
	}
}

// ── Restart tests ────────────────────────────────────────────────────────────

// TestRestart verifies that Restart terminates the old process and spawns a new
// one with the new configuration.
func TestRestart(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}
	proc1 := <-procs

	go func() {
		for !proc1.receivedSIGTERM() {
			time.Sleep(1 * time.Millisecond)
		}
		proc1.exit(nil)
	}()

	if err := s.Restart("pipe1", cfg, 2, "", nil); err != nil {
		t.Fatalf("Restart() error: %v", err)
	}

	select {
	case proc2 := <-procs:
		if proc2.Pid() == proc1.Pid() {
			t.Error("restarted process should have a different PID")
		}
		proc2.exit(nil)
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for restarted process")
	}
}

// ── ShutdownAll tests ─────────────────────────────────────────────────────────

// TestShutdownAll verifies that all active pipelines are stopped concurrently
// and none remain in the active map afterwards.
func TestShutdownAll(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)

	const n = 3
	for i := 0; i < n; i++ {
		if err := s.Start(fmt.Sprintf("pipe%d", i), cfg, 1, "", nil); err != nil {
			t.Fatalf("Start pipe%d: %v", i, err)
		}
	}

	// All n procs are available; respond to SIGTERM by exiting.
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			proc := <-procs
			for !proc.receivedSIGTERM() && !proc.wasKilled() {
				time.Sleep(1 * time.Millisecond)
			}
			proc.exit(nil)
		}()
	}

	s.ShutdownAll()
	wg.Wait()

	if statuses := s.Statuses(); len(statuses) != 0 {
		t.Errorf("expected 0 active pipelines after ShutdownAll, got %d", len(statuses))
	}
}

// ── Metadata tests ────────────────────────────────────────────────────────────

// TestStatuses verifies that Statuses returns the correct pipeline metadata.
func TestStatuses(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 42, "debug", map[string]string{"K": "V"}); err != nil {
		t.Fatal(err)
	}
	<-procs

	statuses := s.Statuses()
	if len(statuses) != 1 {
		t.Fatalf("expected 1 status, got %d", len(statuses))
	}
	st := statuses[0]
	if st.PipelineID != "pipe1" {
		t.Errorf("PipelineID: got %q, want %q", st.PipelineID, "pipe1")
	}
	if st.Version != 42 {
		t.Errorf("Version: got %d, want 42", st.Version)
	}
	if st.PID != 1000 {
		t.Errorf("PID: got %d, want 1000", st.PID)
	}
}

// TestUpdateVersion verifies that UpdateVersion changes the version field
// without restarting the process.
func TestUpdateVersion(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}
	<-procs

	s.UpdateVersion("pipe1", 99)

	for _, st := range s.Statuses() {
		if st.PipelineID == "pipe1" && st.Version != 99 {
			t.Errorf("Version: got %d, want 99", st.Version)
		}
	}
}

// TestSetConfigChecksum verifies that SetConfigChecksum stores the checksum on
// the pipeline's status entry.
func TestSetConfigChecksum(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}
	<-procs

	s.SetConfigChecksum("pipe1", "abc123")

	for _, st := range s.Statuses() {
		if st.PipelineID == "pipe1" && st.ConfigChecksum != "abc123" {
			t.Errorf("ConfigChecksum: got %q, want %q", st.ConfigChecksum, "abc123")
		}
	}
}

// TestGetRecentLogs verifies that bytes written to the process's stdout writer
// are buffered in the ring buffer and returned by GetRecentLogs, then cleared.
func TestGetRecentLogs(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}
	proc := <-procs

	// Write through the stdout writer that the factory provided to the mock.
	fmt.Fprintln(proc.stdout, "log line 1")
	fmt.Fprintln(proc.stdout, "log line 2")

	logs := s.GetRecentLogs("pipe1")
	if len(logs) != 2 {
		t.Errorf("expected 2 log lines, got %d: %v", len(logs), logs)
	}

	// Second call: buffer was cleared after the first read.
	if logs2 := s.GetRecentLogs("pipe1"); len(logs2) != 0 {
		t.Errorf("expected empty after first read, got %d lines", len(logs2))
	}

	// Non-existent pipeline returns nil.
	if got := s.GetRecentLogs("no-such-pipe"); got != nil {
		t.Errorf("expected nil for missing pipeline, got %v", got)
	}

	proc.exit(nil)
}

// ── Goroutine leak / race detector tests ─────────────────────────────────────

// TestContextCancellation_NoGoroutineLeak verifies that stopping a pipeline
// causes the monitor goroutine to exit cleanly, leaving no leaked goroutines.
func TestContextCancellation_NoGoroutineLeak(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { drainProcs(procs) })

	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatal(err)
	}
	proc := <-procs

	// Allow the monitor goroutine to reach its Wait() call.
	time.Sleep(20 * time.Millisecond)

	before := runtime.NumGoroutine()

	// Respond to SIGTERM immediately.
	go func() {
		for !proc.receivedSIGTERM() {
			time.Sleep(1 * time.Millisecond)
		}
		proc.exit(nil)
	}()

	s.Stop("pipe1")

	// Allow the scheduler to fully deschedule the exited goroutines.
	time.Sleep(30 * time.Millisecond)

	after := runtime.NumGoroutine()

	if after >= before {
		t.Errorf("goroutine leak: before=%d after=%d; expected count to decrease",
			before, after)
	}
}

// TestConcurrentPipelines verifies that multiple pipelines can run concurrently
// without data races (this test is most valuable when run with -race).
func TestConcurrentPipelines(t *testing.T) {
	s, procs := newTestSupervisor(nil)
	cfg := tempConfig(t)
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	const n = 5
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("pipe%d", i)
		if err := s.Start(id, cfg, i, "", nil); err != nil {
			t.Fatalf("Start %s: %v", id, err)
		}
	}

	// Drain procs — each exits cleanly.
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			proc := <-procs
			proc.exit(nil)
		}()
	}

	// Concurrently exercise read and write metadata paths.
	var rwg sync.WaitGroup
	for i := 0; i < 20; i++ {
		rwg.Add(1)
		go func(i int) {
			defer rwg.Done()
			s.Statuses()
			s.UpdateVersion(fmt.Sprintf("pipe%d", i%n), i)
			s.SetConfigChecksum(fmt.Sprintf("pipe%d", i%n), fmt.Sprintf("chk%d", i))
		}(i)
	}

	rwg.Wait()
	wg.Wait()
}
