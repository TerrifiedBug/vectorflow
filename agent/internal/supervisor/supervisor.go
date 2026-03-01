package supervisor

import (
	"bytes"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/vectorflow/agent/internal/logbuf"
)

type ProcessInfo struct {
	PipelineID string
	Version    int
	PID        int
	Status     string // RUNNING, STARTING, STOPPED, CRASHED
	StartedAt  time.Time
	APIPort    int
	Secrets    map[string]string
	cmd        *exec.Cmd
	configPath string
	restarts   int
	done       chan struct{}
	logBuf     *logbuf.RingBuffer
}

type Supervisor struct {
	vectorBin string
	mu        sync.Mutex
	processes map[string]*ProcessInfo // pipelineId -> process
	basePort  int
	portSeq   int
}

func New(vectorBin string) *Supervisor {
	return &Supervisor{
		vectorBin: vectorBin,
		processes: make(map[string]*ProcessInfo),
		basePort:  8687, // 8686 is reserved for API, start from 8687
	}
}

func (s *Supervisor) nextPort() int {
	s.portSeq++
	return s.basePort + s.portSeq
}

// Start spawns a new Vector process for a pipeline.
func (s *Supervisor) Start(pipelineID, configPath string, version int, secrets map[string]string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.processes[pipelineID]; exists {
		return fmt.Errorf("pipeline %s already running", pipelineID)
	}

	port := s.nextPort()
	return s.startProcess(pipelineID, configPath, version, secrets, port)
}

func (s *Supervisor) startProcess(pipelineID, configPath string, version int, secrets map[string]string, port int) error {
	// Inject api: block into the config file so the agent can scrape metrics
	// via Vector's GraphQL endpoint. The env var VECTOR_API_ENABLED doesn't
	// exist — it must be in the config file.
	if err := injectAPIConfig(configPath, port); err != nil {
		slog.Warn("could not inject API config", "pipeline", pipelineID, "error", err)
	}

	cmd := exec.Command(s.vectorBin,
		"--config", configPath,
	)

	// Inject secrets as environment variables
	cmd.Env = os.Environ()
	for k, v := range secrets {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	lb := logbuf.New(500)
	cmd.Stdout = io.MultiWriter(os.Stdout, lb)
	cmd.Stderr = io.MultiWriter(os.Stderr, lb)

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start vector for pipeline %s: %w", pipelineID, err)
	}

	info := &ProcessInfo{
		PipelineID: pipelineID,
		Version:    version,
		PID:        cmd.Process.Pid,
		Status:     "STARTING",
		StartedAt:  time.Now(),
		APIPort:    port,
		Secrets:    secrets,
		cmd:        cmd,
		configPath: configPath,
		done:       make(chan struct{}),
		logBuf:     lb,
	}
	s.processes[pipelineID] = info

	// Monitor the process in a goroutine
	go s.monitor(info, port)

	return nil
}

func (s *Supervisor) monitor(info *ProcessInfo, port int) {
	// Mark as running after brief startup delay
	time.Sleep(2 * time.Second)
	s.mu.Lock()
	if p, ok := s.processes[info.PipelineID]; ok && p == info && p.Status == "STARTING" {
		p.Status = "RUNNING"
	}
	s.mu.Unlock()

	// Wait for process to exit
	err := info.cmd.Wait()
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
		backoff := time.Duration(1<<minInt(info.restarts-1, 6)) * time.Second
		if backoff > 60*time.Second {
			backoff = 60 * time.Second
		}

		slog.Info("restarting crashed pipeline", "pipeline", info.PipelineID, "backoff", backoff, "restarts", info.restarts)

		go func() {
			time.Sleep(backoff)
			s.mu.Lock()
			defer s.mu.Unlock()
			// Check it hasn't been stopped/replaced while we waited
			if current, ok := s.processes[info.PipelineID]; ok && current == info {
				delete(s.processes, info.PipelineID)
				s.startProcess(info.PipelineID, info.configPath, info.Version, info.Secrets, port)
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
	if info.cmd.Process == nil {
		return nil
	}

	// Send SIGTERM
	info.cmd.Process.Signal(syscall.SIGTERM)

	// Wait up to 30s for graceful shutdown
	select {
	case <-info.done:
		return nil
	case <-time.After(30 * time.Second):
		slog.Warn("pipeline did not stop after timeout, sending SIGKILL", "pipeline", info.PipelineID)
		info.cmd.Process.Kill()
		<-info.done
		return nil
	}
}

// Restart stops and starts a pipeline with new config.
func (s *Supervisor) Restart(pipelineID, configPath string, version int, secrets map[string]string) error {
	s.Stop(pipelineID)

	s.mu.Lock()
	defer s.mu.Unlock()

	port := s.nextPort()
	return s.startProcess(pipelineID, configPath, version, secrets, port)
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
			PipelineID: info.PipelineID,
			Version:    info.Version,
			PID:        info.PID,
			Status:     info.Status,
			StartedAt:  info.StartedAt,
			APIPort:    info.APIPort,
		})
	}
	return result
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

// injectAPIConfig prepends a Vector API block to the pipeline config YAML
// so the agent can scrape metrics from Vector's GraphQL endpoint.
func injectAPIConfig(configPath string, port int) error {
	content, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}
	// Don't double-inject on crash restarts
	if bytes.Contains(content, []byte("api:\n  enabled: true\n")) {
		return nil
	}
	apiBlock := fmt.Sprintf("api:\n  enabled: true\n  address: \"127.0.0.1:%d\"\n\n", port)
	return os.WriteFile(configPath, append([]byte(apiBlock), content...), 0600)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
