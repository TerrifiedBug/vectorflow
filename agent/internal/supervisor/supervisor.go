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
	Status         string // RUNNING, STARTING, STOPPED, CRASHED
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
	vectorBin    string
	mu           sync.Mutex
	processes    map[string]*ProcessInfo // pipelineId -> process
	basePort     int
	portSeq      int
	mkProc       procFactory
	startupDelay time.Duration
	backoffFunc  func(restarts int) time.Duration
	stopTimeout  time.Duration
}

func New(vectorBin string) *Supervisor {
	return &Supervisor{
		vectorBin:    vectorBin,
		processes:    make(map[string]*ProcessInfo),
		basePort:     8687, // prometheus_exporter ports start at 8688 (portSeq increments before use)
		mkProc:       defaultProcFactory,
		startupDelay: 2 * time.Second,
		backoffFunc:  defaultBackoffFunc,
		stopTimeout:  30 * time.Second,
	}
}

func (s *Supervisor) nextPort() int {
	s.portSeq++
	return s.basePort + s.portSeq
}

// Start spawns a new Vector process for a pipeline.
func (s *Supervisor) Start(pipelineID, configPath string, version int, logLevel string, secrets map[string]string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.processes[pipelineID]; exists {
		return fmt.Errorf("pipeline %s already running", pipelineID)
	}

	metricsPort := s.nextPort()
	apiPort := s.nextPort()
	return s.startProcess(pipelineID, configPath, version, logLevel, secrets, metricsPort, apiPort)
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

		// Exponential backoff restart: 1s, 2s, 4s, 8s, ... max 60s
		info.restarts++
		backoff := s.backoffFunc(info.restarts)

		slog.Info("restarting crashed pipeline", "pipeline", info.PipelineID, "backoff", backoff, "restarts", info.restarts)

		go func() {
			time.Sleep(backoff)
			s.mu.Lock()
			defer s.mu.Unlock()
			// Check it hasn't been stopped/replaced while we waited
			if current, ok := s.processes[info.PipelineID]; ok && current == info {
				delete(s.processes, info.PipelineID)
				s.startProcess(info.PipelineID, info.configPath, info.Version, info.LogLevel, info.Secrets, metricsPort, apiPort)
			}
		}()
	} else {
		slog.Info("pipeline exited cleanly", "pipeline", info.PipelineID, "pid", info.PID)
		info.Status = "STOPPED"
	}
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

	metricsPort := s.nextPort()
	apiPort := s.nextPort()
	return s.startProcess(pipelineID, configPath, version, logLevel, secrets, metricsPort, apiPort)
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
