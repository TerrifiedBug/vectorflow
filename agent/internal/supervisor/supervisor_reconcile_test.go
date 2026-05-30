package supervisor

import (
	"errors"
	"io"
	"sync"
	"testing"
	"time"
)

// newFailWindowFactory returns a procFactory whose created processes fail
// proc.Start() for calls in the half-open attempt range [failFrom, failUntil),
// and succeed otherwise. Attempt numbers are 1-based in creation order.
//
// Every created *mockProc is still pushed onto the returned channel (matching
// newMockFactory), so tests can observe and unblock each attempt regardless of
// whether its Start() succeeded.
func newFailWindowFactory(failFrom, failUntil int) (procFactory, chan *mockProc, *int) {
	ch := make(chan *mockProc, 16)
	var mu sync.Mutex
	attempt := 0
	factory := func(bin string, args, env []string, stdout, stderr io.Writer) supervisedProcess {
		mu.Lock()
		attempt++
		n := attempt
		mu.Unlock()

		var startErr error
		if n >= failFrom && n < failUntil {
			startErr = errors.New("simulated start failure")
		}
		mp := &mockProc{
			pid:      n * 1000,
			stdout:   stdout,
			stderr:   stderr,
			startErr: startErr,
			exitCh:   make(chan error, 1),
		}
		ch <- mp
		return mp
	}
	return factory, ch, &attempt
}

// nextSeqPort reads the supervisor's high-water sequential port allocator.
func nextSeqPort(s *Supervisor) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nextSeqPort
}

// TestRestartFailure_ReconcilesAndRecovers verifies VF #152: when a restart's
// startProcess fails, the pipeline is NOT permanently dropped. The supervisor
// keeps the pipeline registered, retries under backoff, and recovers once the
// underlying start succeeds again.
func TestRestartFailure_ReconcilesAndRecovers(t *testing.T) {
	// Attempt 1 = initial Start (succeeds). Attempt 2 = restart after crash
	// (fails). Attempt 3 = reconciling retry (succeeds).
	factory, procs, _ := newFailWindowFactory(2, 3)

	s := New("/fake/vector")
	s.mkProc = factory
	s.startupDelay = 0
	s.backoffFunc = func(int) time.Duration { return 0 }
	s.stopTimeout = 50 * time.Millisecond
	s.stableThreshold = time.Hour // every crash/failure counts toward the loop
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	cfg := tempConfig(t)
	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Attempt 1: healthy process. Crash it to trigger a restart.
	p1 := <-procs
	p1.exit(errors.New("crash"))

	// Attempt 2: the restart whose Start() fails. It is still created and pushed
	// onto the channel; drain it so the channel does not back-pressure.
	<-procs

	// The pipeline must remain registered (reconciled), not dropped. Attempt 3
	// is the reconciling retry that succeeds.
	select {
	case p3 := <-procs:
		// Recovered process should be live; let it settle to RUNNING then exit.
		waitForStatus(t, s, "pipe1", "RUNNING", 500*time.Millisecond)
		p3.exit(nil)
	case <-time.After(time.Second):
		t.Fatal("pipeline was dropped after a failed restart; expected a reconciling retry")
	}
}

// TestRestartFailure_DoesNotLeakPorts verifies that a failed restart returns its
// reserved ports to the pool so churn does not climb toward the port ceiling.
func TestRestartFailure_DoesNotLeakPorts(t *testing.T) {
	// Attempt 1 succeeds, attempt 2 (restart) fails, attempt 3 succeeds.
	factory, procs, _ := newFailWindowFactory(2, 3)

	s := New("/fake/vector")
	s.mkProc = factory
	s.startupDelay = 0
	s.backoffFunc = func(int) time.Duration { return 0 }
	s.stopTimeout = 50 * time.Millisecond
	s.stableThreshold = time.Hour
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	cfg := tempConfig(t)
	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// The initial Start consumes exactly one metrics+API port pair from the
	// sequential allocator. A failed restart that leaked ports would force the
	// reconciling retry to burn a fresh pair, advancing nextSeqPort.
	seqAfterStart := nextSeqPort(s)

	p1 := <-procs
	p1.exit(errors.New("crash"))
	<-procs // attempt 2 (failed restart)

	select {
	case p3 := <-procs: // attempt 3 (recovered)
		waitForStatus(t, s, "pipe1", "RUNNING", 500*time.Millisecond)

		// The failed attempt's two ports must have been returned to the pool and
		// reused by the recovering process — so the sequential allocator must not
		// have advanced past where it was after the initial Start.
		if got := nextSeqPort(s); got != seqAfterStart {
			t.Errorf("failed restart leaked ports: nextSeqPort advanced from %d to %d (expected reuse of freed ports)",
				seqAfterStart, got)
		}
		p3.exit(nil)
	case <-time.After(time.Second):
		t.Fatal("no reconciling retry after failed restart")
	}
}

// TestRestartFailure_GivesUpAfterMaxRestarts verifies the circuit breaker still
// applies to repeated restart *failures* (not just crashes): the supervisor
// stops retrying and marks the pipeline CRASH_LOOP instead of looping forever.
func TestRestartFailure_GivesUpAfterMaxRestarts(t *testing.T) {
	// Attempt 1 succeeds; every restart attempt thereafter fails.
	factory, procs, _ := newFailWindowFactory(2, 1<<30)

	s := New("/fake/vector")
	s.mkProc = factory
	s.startupDelay = 0
	s.backoffFunc = func(int) time.Duration { return 0 }
	s.stopTimeout = 50 * time.Millisecond
	s.stableThreshold = time.Hour
	s.maxRestarts = 3
	t.Cleanup(func() { s.ShutdownAll(); drainProcs(procs) })

	cfg := tempConfig(t)
	if err := s.Start("pipe1", cfg, 1, "", nil); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	p1 := <-procs
	p1.exit(errors.New("crash"))

	// Drain failed restart attempts in the background so the factory channel
	// never blocks the reconciliation goroutine.
	stop := make(chan struct{})
	go func() {
		for {
			select {
			case <-procs:
			case <-stop:
				return
			}
		}
	}()
	t.Cleanup(func() { close(stop) })

	waitForStatus(t, s, "pipe1", "CRASH_LOOP", 2*time.Second)
}
