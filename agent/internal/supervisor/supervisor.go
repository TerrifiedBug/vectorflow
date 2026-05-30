package supervisor

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/TerrifiedBug/vectorflow/agent/internal/logbuf"
)

// supervisedProcess abstracts an OS subprocess for lifecycle management.
// The real implementation wraps *exec.Cmd; tests substitute mocks.
type supervisedProcess interface {
	Start() error
	Wait() error
	Pid() int
	Signal(sig os.Signal) error
	Kill() error
}

// procFactory creates and configures a new supervisedProcess.
type procFactory func(bin string, args, env []string, stdout, stderr io.Writer) supervisedProcess

// cmdProcess wraps *exec.Cmd to implement supervisedProcess.
type cmdProcess struct {
	cmd *exec.Cmd
}

func (p *cmdProcess) Start() error               { return p.cmd.Start() }
func (p *cmdProcess) Wait() error                { return p.cmd.Wait() }
func (p *cmdProcess) Pid() int                   { return p.cmd.Process.Pid }
func (p *cmdProcess) Signal(sig os.Signal) error { return p.cmd.Process.Signal(sig) }
func (p *cmdProcess) Kill() error                { return p.cmd.Process.Kill() }

// defaultProcFactory builds the real exec.Cmd-backed supervisedProcess.
func defaultProcFactory(bin string, args, env []string, stdout, stderr io.Writer) supervisedProcess {
	cmd := exec.Command(bin, args...)
	cmd.Env = env
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	return &cmdProcess{cmd: cmd}
}

// defaultBackoffFunc returns exponential backoff capped at 60s.
func defaultBackoffFunc(restarts int) time.Duration {
	backoff := time.Duration(1<<minInt(restarts-1, 6)) * time.Second
	if backoff > 60*time.Second {
		backoff = 60 * time.Second
	}
	return backoff
}

type ProcessInfo struct {
	PipelineID     string
	Version        int
	PID            int
	Status         string // RUNNING, STARTING, STOPPED, CRASHED, CRASH_LOOP
	StartedAt      time.Time
	MetricsPort    int
	APIPort        int
	LogLevel       string
	Secrets        map[string]string
	ConfigChecksum string
	proc           supervisedProcess
	configPath     string
	restarts       int
	done           chan struct{}
	logBuf         *logbuf.RingBuffer
}

type Supervisor struct {
	vectorBin string
	mu        sync.Mutex
	processes map[string]*ProcessInfo // pipelineId -> process
	// restartCounts persists the consecutive crash count per pipeline across
	// process replacements. Each crash replaces the ProcessInfo via
	// startProcess (which starts at restarts=0), so the count cannot live on
	// ProcessInfo — otherwise the backoff would reset to ~1s on every crash
	// and a crash-looping pipeline would restart roughly once per second
	// forever. Reset to 0 after a process stays up past stableThreshold.
	restartCounts map[string]int
	// Port allocation. Ports handed to a process are returned to freePorts when
	// it stops, crashes terminally, or is replaced, so a node that churns
	// pipelines reuses ports instead of climbing toward the 65535 ceiling and
	// eventually failing to bind. nextSeqPort is only advanced when no freed
	// port is available, and never past maxPort.
	basePort        int
	nextSeqPort     int   // next never-before-used port to hand out
	maxPort         int   // upper bound; allocation fails above this
	freePorts       []int // ports released by stopped processes, available for reuse
	mkProc          procFactory
	startupDelay    time.Duration
	backoffFunc     func(restarts int) time.Duration
	stopTimeout     time.Duration
	stableThreshold time.Duration // uptime above which a crash is treated as a one-off, not a loop
	maxRestarts     int           // consecutive rapid crashes before giving up (CRASH_LOOP)
}

func New(vectorBin string) *Supervisor {
	const basePort = 8687 // prometheus_exporter ports start at 8688 (first allocation increments before use)
	return &Supervisor{
		vectorBin:       vectorBin,
		processes:       make(map[string]*ProcessInfo),
		restartCounts:   make(map[string]int),
		basePort:        basePort,
		nextSeqPort:     basePort + 1,
		maxPort:         65535, // highest valid TCP port
		mkProc:          defaultProcFactory,
		startupDelay:    2 * time.Second,
		backoffFunc:     defaultBackoffFunc,
		stopTimeout:     30 * time.Second,
		stableThreshold: 60 * time.Second,
		maxRestarts:     10,
	}
}

// allocatePortPair reserves a metrics and an API port, preferring previously
// freed ports. It returns an error if the allocator has reached maxPort, which
// surfaces exhaustion to the caller instead of returning an invalid port.
// Callers must hold s.mu.
func (s *Supervisor) allocatePortPair() (metricsPort, apiPort int, err error) {
	metricsPort, err = s.nextPort()
	if err != nil {
		return 0, 0, err
	}
	apiPort, err = s.nextPort()
	if err != nil {
		// Return the metrics port to the pool so a transient exhaustion does not
		// permanently lose it.
		s.releasePort(metricsPort)
		return 0, 0, err
	}
	return metricsPort, apiPort, nil
}

// nextPort returns the next available port, reusing a freed port when possible.
// Callers must hold s.mu.
func (s *Supervisor) nextPort() (int, error) {
	if n := len(s.freePorts); n > 0 {
		port := s.freePorts[n-1]
		s.freePorts = s.freePorts[:n-1]
		return port, nil
	}
	if s.nextSeqPort > s.maxPort {
		return 0, fmt.Errorf("no available ports (exhausted range %d-%d)", s.basePort+1, s.maxPort)
	}
	port := s.nextSeqPort
	s.nextSeqPort++
	return port, nil
}

// releasePort returns a port to the free pool for reuse. Callers must hold
// s.mu. Ports outside the managed range (e.g. zero values) are ignored.
func (s *Supervisor) releasePort(port int) {
	if port <= s.basePort || port > s.maxPort {
		return
	}
	s.freePorts = append(s.freePorts, port)
}

// releasePorts returns both of a process's ports to the free pool. Callers must
// hold s.mu.
func (s *Supervisor) releasePorts(info *ProcessInfo) {
	if info == nil {
		return
	}
	s.releasePort(info.MetricsPort)
	s.releasePort(info.APIPort)
}

// Start spawns a new Vector process for a pipeline.
func (s *Supervisor) Start(pipelineID, configPath string, version int, logLevel string, secrets map[string]string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.processes[pipelineID]; exists {
		return fmt.Errorf("pipeline %s already running", pipelineID)
	}

	metricsPort, apiPort, err := s.allocatePortPair()
	if err != nil {
		return fmt.Errorf("start pipeline %s: %w", pipelineID, err)
	}
	if err := s.startProcess(pipelineID, configPath, version, logLevel, secrets, metricsPort, apiPort); err != nil {
		// startProcess failed before the process was registered; return the
		// reserved ports to the pool so they are not leaked.
		s.releasePort(metricsPort)
		s.releasePort(apiPort)
		return err
	}
	return nil
}

func (s *Supervisor) startProcess(pipelineID, configPath string, version int, logLevel string, secrets map[string]string, metricsPort, apiPort int) error {
	// Write a sidecar metrics config (internal_metrics, host_metrics,
	// prometheus_exporter) and pass it as a second --config so Vector merges
	// both files without YAML key collisions.
	args := []string{"--config", configPath}
	sidecarPath, err := writeSidecarConfig(configPath, metricsPort, apiPort)
	if err != nil {
		slog.Warn("could not write metrics sidecar config", "pipeline", pipelineID, "error", err)
	} else {
		args = append(args, "--config", sidecarPath)
	}

	env := os.Environ()
	if logLevel != "" {
		env = append(env, "VECTOR_LOG="+logLevel)
	}
	for k, v := range secrets {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}

	lb := logbuf.New(500)
	stdout := io.MultiWriter(os.Stdout, lb)
	stderr := io.MultiWriter(os.Stderr, lb)

	proc := s.mkProc(s.vectorBin, args, env, stdout, stderr)
	if err := proc.Start(); err != nil {
		return fmt.Errorf("start vector for pipeline %s: %w", pipelineID, err)
	}

	info := &ProcessInfo{
		PipelineID:  pipelineID,
		Version:     version,
		PID:         proc.Pid(),
		Status:      "STARTING",
		StartedAt:   time.Now(),
		MetricsPort: metricsPort,
		APIPort:     apiPort,
		LogLevel:    logLevel,
		Secrets:     secrets,
		proc:        proc,
		configPath:  configPath,
		done:        make(chan struct{}),
		logBuf:      lb,
	}
	s.processes[pipelineID] = info

	// Monitor the process in a goroutine
	go s.monitor(info, metricsPort, apiPort)

	return nil
}

func (s *Supervisor) monitor(info *ProcessInfo, metricsPort, apiPort int) {
	// Mark as running after brief startup delay
	time.Sleep(s.startupDelay)
	s.mu.Lock()
	if p, ok := s.processes[info.PipelineID]; ok && p == info && p.Status == "STARTING" {
		p.Status = "RUNNING"
	}
	s.mu.Unlock()

	// Wait for process to exit
	err := info.proc.Wait()
	close(info.done)

	s.mu.Lock()
	defer s.mu.Unlock()

	current, exists := s.processes[info.PipelineID]
	if !exists || current != info {
		return // process was replaced
	}

	if err != nil {
		slog.Error("pipeline crashed", "pipeline", info.PipelineID, "pid", info.PID, "error", err)
		info.Status = "CRASHED"

		// A process that stayed up past stableThreshold is treated as healthy:
		// this crash is a one-off, so reset the consecutive-crash counter.
		if time.Since(info.StartedAt) >= s.stableThreshold {
			s.restartCounts[info.PipelineID] = 0
		}
		s.restartCounts[info.PipelineID]++
		count := s.restartCounts[info.PipelineID]
		info.restarts = count

		// Circuit breaker: after too many rapid crashes, stop thrashing and
		// surface a terminal CRASH_LOOP state. A later config push (Restart)
		// clears the counter and gives the pipeline another chance.
		if count > s.maxRestarts {
			info.Status = "CRASH_LOOP"
			slog.Error("pipeline crash-looping, giving up until next config change",
				"pipeline", info.PipelineID, "restarts", count, "max", s.maxRestarts)
			return
		}

		// Exponential backoff restart: 1s, 2s, 4s, 8s, ... max 60s.
		backoff := s.backoffFunc(count)
		slog.Info("restarting crashed pipeline", "pipeline", info.PipelineID, "backoff", backoff, "restarts", count)

		go s.restartAfter(info, backoff, metricsPort, apiPort)
	} else {
		slog.Info("pipeline exited cleanly", "pipeline", info.PipelineID, "pid", info.PID)
		info.Status = "STOPPED"
		delete(s.restartCounts, info.PipelineID)
	}
}

// restartAfter waits for the backoff and then attempts to replace a crashed
// pipeline's process. It runs in its own goroutine.
//
// If startProcess fails (e.g. transient resource exhaustion or a failed bind),
// the pipeline must NOT be permanently dropped: instead the crashed entry is
// left in the map in a CRASHED state, the reserved ports are returned to the
// pool, and another restart is scheduled under the same backoff/circuit-breaker
// policy as a crash. This reconciliation loop keeps retrying until the process
// starts or the consecutive-failure count trips the crash-loop breaker.
func (s *Supervisor) restartAfter(info *ProcessInfo, backoff time.Duration, metricsPort, apiPort int) {
	time.Sleep(backoff)

	s.mu.Lock()
	defer s.mu.Unlock()

	// Bail out if the pipeline was stopped or replaced while we waited.
	current, ok := s.processes[info.PipelineID]
	if !ok || current != info {
		// Ports for this attempt are no longer ours to use; whoever replaced the
		// entry owns its own ports, so just return these to the pool.
		s.releasePort(metricsPort)
		s.releasePort(apiPort)
		return
	}

	delete(s.processes, info.PipelineID)
	if err := s.startProcess(info.PipelineID, info.configPath, info.Version, info.LogLevel, info.Secrets, metricsPort, apiPort); err != nil {
		// The restart itself failed before a process was registered. Don't drop
		// the pipeline: re-register the crashed entry and schedule a reconciling
		// retry so a transient failure self-heals.
		s.releasePort(metricsPort)
		s.releasePort(apiPort)
		s.reconcileFailedRestart(info, err)
	}
}

// reconcileFailedRestart re-registers a pipeline whose restart attempt failed
// and schedules another attempt, escalating the backoff and honouring the
// crash-loop circuit breaker exactly as a real crash would. Callers must hold
// s.mu.
func (s *Supervisor) reconcileFailedRestart(info *ProcessInfo, cause error) {
	info.Status = "CRASHED"
	s.processes[info.PipelineID] = info

	s.restartCounts[info.PipelineID]++
	count := s.restartCounts[info.PipelineID]
	info.restarts = count

	if count > s.maxRestarts {
		info.Status = "CRASH_LOOP"
		slog.Error("pipeline restart keeps failing, giving up until next config change",
			"pipeline", info.PipelineID, "restarts", count, "max", s.maxRestarts, "error", cause)
		return
	}

	backoff := s.backoffFunc(count)
	slog.Error("pipeline restart failed, reconciling with retry",
		"pipeline", info.PipelineID, "backoff", backoff, "restarts", count, "error", cause)

	metricsPort, apiPort, err := s.allocatePortPair()
	if err != nil {
		// No ports available right now; retry the whole reconciliation later
		// without consuming a port pair. The crash counter already advanced, so
		// repeated exhaustion will eventually trip the breaker.
		slog.Error("could not allocate ports for pipeline restart, will retry",
			"pipeline", info.PipelineID, "error", err)
		go func() {
			time.Sleep(backoff)
			s.mu.Lock()
			defer s.mu.Unlock()
			if current, ok := s.processes[info.PipelineID]; ok && current == info {
				s.reconcileFailedRestart(info, err)
			}
		}()
		return
	}
	go s.restartAfter(info, backoff, metricsPort, apiPort)
}

// Stop terminates a running pipeline process.
func (s *Supervisor) Stop(pipelineID string) error {
	s.mu.Lock()
	info, exists := s.processes[pipelineID]
	if !exists {
		s.mu.Unlock()
		return nil
	}
	delete(s.processes, pipelineID)
	delete(s.restartCounts, pipelineID)
	s.releasePorts(info)
	s.mu.Unlock()

	return s.stopProcess(info)
}

func (s *Supervisor) stopProcess(info *ProcessInfo) error {
	// Send SIGTERM
	info.proc.Signal(syscall.SIGTERM) //nolint:errcheck

	// Wait up to stopTimeout for graceful shutdown
	select {
	case <-info.done:
	case <-time.After(s.stopTimeout):
		slog.Warn("pipeline did not stop after timeout, sending SIGKILL", "pipeline", info.PipelineID)
		info.proc.Kill() //nolint:errcheck
		<-info.done
	}

	// Clean up sidecar metrics config file
	metricsPath := info.configPath + ".vf-metrics.yaml"
	if err := os.Remove(metricsPath); err != nil && !os.IsNotExist(err) {
		slog.Warn("could not remove metrics sidecar config", "path", metricsPath, "error", err)
	}

	return nil
}

// Restart stops and starts a pipeline with new config.
func (s *Supervisor) Restart(pipelineID, configPath string, version int, logLevel string, secrets map[string]string) error {
	s.Stop(pipelineID)

	s.mu.Lock()
	defer s.mu.Unlock()

	metricsPort, apiPort, err := s.allocatePortPair()
	if err != nil {
		return fmt.Errorf("restart pipeline %s: %w", pipelineID, err)
	}
	if err := s.startProcess(pipelineID, configPath, version, logLevel, secrets, metricsPort, apiPort); err != nil {
		s.releasePort(metricsPort)
		s.releasePort(apiPort)
		return err
	}
	return nil
}

// RestartInPlace restarts a pipeline using its currently stored config.
// Used by push-triggered restarts where the config has not changed.
func (s *Supervisor) RestartInPlace(pipelineID string) error {
	s.mu.Lock()
	info, exists := s.processes[pipelineID]
	if !exists {
		s.mu.Unlock()
		return fmt.Errorf("pipeline %s not found", pipelineID)
	}
	// Copy config fields and atomically remove the entry from the map while
	// still holding the lock. This closes the TOCTOU window where the
	// crash-recovery goroutine could replace s.processes[pipelineID] with a
	// newly-recovered process between our read and the subsequent Stop call,
	// which would cause Stop to kill the recovered process instead.
	configPath := info.configPath
	version := info.Version
	logLevel := info.LogLevel
	secrets := info.Secrets
	delete(s.processes, pipelineID)
	delete(s.restartCounts, pipelineID)
	s.releasePorts(info)
	s.mu.Unlock()

	s.stopProcess(info)

	s.mu.Lock()
	defer s.mu.Unlock()
	metricsPort, apiPort, err := s.allocatePortPair()
	if err != nil {
		return fmt.Errorf("restart pipeline %s: %w", pipelineID, err)
	}
	if err := s.startProcess(pipelineID, configPath, version, logLevel, secrets, metricsPort, apiPort); err != nil {
		s.releasePort(metricsPort)
		s.releasePort(apiPort)
		return err
	}
	return nil
}

// UpdateVersion updates the reported version for a pipeline without restarting.
// Used when a new deploy creates a version with identical config.
func (s *Supervisor) UpdateVersion(pipelineID string, version int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if info, ok := s.processes[pipelineID]; ok {
		info.Version = version
	}
}

// Statuses returns the current status of all managed pipelines.
func (s *Supervisor) Statuses() []ProcessInfo {
	s.mu.Lock()
	defer s.mu.Unlock()

	var result []ProcessInfo
	for _, info := range s.processes {
		result = append(result, ProcessInfo{
			PipelineID:     info.PipelineID,
			Version:        info.Version,
			PID:            info.PID,
			Status:         info.Status,
			StartedAt:      info.StartedAt,
			MetricsPort:    info.MetricsPort,
			APIPort:        info.APIPort,
			ConfigChecksum: info.ConfigChecksum,
		})
	}
	return result
}

// SetConfigChecksum stores the config checksum applied for a pipeline.
func (s *Supervisor) SetConfigChecksum(pipelineID, checksum string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if info, ok := s.processes[pipelineID]; ok {
		info.ConfigChecksum = checksum
	}
}

// GetRecentLogs returns and clears the recent log lines for a pipeline.
func (s *Supervisor) GetRecentLogs(pipelineID string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	info, ok := s.processes[pipelineID]
	if !ok || info.logBuf == nil {
		return nil
	}
	return info.logBuf.Lines()
}

// ShutdownAll gracefully terminates all running pipelines.
func (s *Supervisor) ShutdownAll() {
	s.mu.Lock()
	infos := make([]*ProcessInfo, 0, len(s.processes))
	for _, info := range s.processes {
		infos = append(infos, info)
		s.releasePorts(info)
	}
	s.processes = make(map[string]*ProcessInfo)
	s.mu.Unlock()

	var wg sync.WaitGroup
	for _, info := range infos {
		wg.Add(1)
		go func(i *ProcessInfo) {
			defer wg.Done()
			s.stopProcess(i)
		}(info)
	}
	wg.Wait()
}

// writeSidecarConfig writes a sidecar Vector config containing internal_metrics +
// host_metrics sources, a prometheus_exporter sink, and the Vector API block.
// It is passed as a second --config argument so Vector merges it with the
// pipeline config, avoiding YAML key collisions.
func writeSidecarConfig(configPath string, metricsPort, apiPort int) (string, error) {
	sidecarPath := configPath + ".vf-metrics.yaml"
	block := fmt.Sprintf(`api:
  enabled: true
  address: "127.0.0.1:%d"

sources:
  vf_internal_metrics:
    type: internal_metrics
  vf_host_metrics:
    type: host_metrics

sinks:
  vf_metrics_exporter:
    type: prometheus_exporter
    inputs: ["vf_internal_metrics", "vf_host_metrics"]
    address: "127.0.0.1:%d"
`, apiPort, metricsPort)
	if err := os.WriteFile(sidecarPath, []byte(block), 0600); err != nil {
		return "", err
	}
	return sidecarPath, nil
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
