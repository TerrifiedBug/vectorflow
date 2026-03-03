package agent

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/config"
	"github.com/TerrifiedBug/vectorflow/agent/internal/sampler"
	"github.com/TerrifiedBug/vectorflow/agent/internal/supervisor"
)

const Version = "0.1.0"

type Agent struct {
	cfg            *config.Config
	client         *client.Client
	poller         *poller
	supervisor     *supervisor.Supervisor
	vectorVersion  string
	deploymentMode string

	mu            sync.Mutex
	sampleResults []client.SampleResultMsg
}

func New(cfg *config.Config) (*Agent, error) {
	c := client.New(cfg.URL)
	sup := supervisor.New(cfg.VectorBin)

	// Detect Vector version
	vectorVersion := ""
	if out, err := exec.Command(cfg.VectorBin, "--version").Output(); err == nil {
		vectorVersion = strings.TrimSpace(string(out))
	}

	return &Agent{
		cfg:            cfg,
		client:         c,
		poller:         newPoller(cfg, c),
		supervisor:     sup,
		vectorVersion:  vectorVersion,
		deploymentMode: DetectDeploymentMode(),
	}, nil
}

func (a *Agent) Run() error {
	// Step 1: Enroll or load existing token
	nodeToken, err := loadOrEnroll(a.cfg, a.client)
	if err != nil {
		return fmt.Errorf("enrollment: %w", err)
	}
	a.client.SetNodeToken(nodeToken)

	slog.Info("VectorFlow Agent starting", "version", Version, "vector", a.vectorVersion)
	slog.Info("polling configured", "url", a.cfg.URL, "interval", a.cfg.PollInterval)

	// Set up signal handling for graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		sig := <-sigCh
		slog.Info("received signal, shutting down", "signal", sig)
		cancel()
	}()

	// Main loop: poll + heartbeat
	ticker := time.NewTicker(a.cfg.PollInterval)
	defer ticker.Stop()

	// Do first poll immediately
	a.pollAndApply()
	a.sendHeartbeat()

	for {
		select {
		case <-ctx.Done():
			slog.Info("shutting down all pipelines")
			a.supervisor.ShutdownAll()
			slog.Info("agent stopped")
			return nil
		case <-ticker.C:
			a.pollAndApply()
			a.sendHeartbeat()
		}
	}
}

func (a *Agent) pollAndApply() {
	actions, err := a.poller.Poll()
	if err != nil {
		slog.Warn("poll error", "error", err)
		return
	}

	for _, action := range actions {
		switch action.Action {
		case ActionStart:
			slog.Info("starting pipeline", "name", action.Name, "version", action.Version)
			if err := a.supervisor.Start(action.PipelineID, action.ConfigPath, action.Version, action.LogLevel, action.Secrets); err != nil {
				slog.Error("failed to start pipeline", "pipeline", action.PipelineID, "error", err)
			}
		case ActionRestart:
			slog.Info("restarting pipeline", "name", action.Name, "version", action.Version, "reason", "config changed")
			if err := a.supervisor.Restart(action.PipelineID, action.ConfigPath, action.Version, action.LogLevel, action.Secrets); err != nil {
				slog.Error("failed to restart pipeline", "pipeline", action.PipelineID, "error", err)
			}
		case ActionStop:
			slog.Info("stopping pipeline", "pipeline", action.PipelineID, "reason", "removed from config")
			if err := a.supervisor.Stop(action.PipelineID); err != nil {
				slog.Error("failed to stop pipeline", "pipeline", action.PipelineID, "error", err)
			}
		case ActionUpdateVersion:
			slog.Debug("updating pipeline version", "name", action.Name, "version", action.Version)
			a.supervisor.UpdateVersion(action.PipelineID, action.Version)
		}
	}

	// Process any sample requests from the server
	if reqs := a.poller.SampleRequests(); len(reqs) > 0 {
		a.processSampleRequests(reqs)
	}
}

func (a *Agent) sendHeartbeat() {
	// Drain accumulated sample results under lock
	a.mu.Lock()
	results := a.sampleResults
	a.sampleResults = nil
	a.mu.Unlock()

	hb := buildHeartbeat(a.supervisor, a.vectorVersion, a.deploymentMode, results)
	if err := a.client.SendHeartbeat(hb); err != nil {
		slog.Warn("heartbeat error", "error", err)
		// Put results back so they retry on the next heartbeat
		if len(results) > 0 {
			a.mu.Lock()
			a.sampleResults = append(results, a.sampleResults...)
			a.mu.Unlock()
		}
	}
}

// processSampleRequests launches goroutines to run vector tap for each sample request.
// Results are appended to a.sampleResults under mutex and sent in the next heartbeat.
func (a *Agent) processSampleRequests(requests []client.SampleRequestMsg) {
	statuses := a.supervisor.Statuses()

	// Build a lookup map of pipeline statuses
	statusMap := make(map[string]supervisor.ProcessInfo, len(statuses))
	for _, s := range statuses {
		statusMap[s.PipelineID] = s
	}

	for _, req := range requests {
		s, found := statusMap[req.PipelineID]
		if !found || s.Status != "RUNNING" || s.APIPort == 0 {
			// Pipeline not running or no API port — record error results immediately
			for _, key := range req.ComponentKeys {
				errMsg := "pipeline not running"
				if !found {
					errMsg = "pipeline not found"
				} else if s.APIPort == 0 {
					errMsg = "pipeline API port not available"
				}
				a.mu.Lock()
				a.sampleResults = append(a.sampleResults, client.SampleResultMsg{
					RequestID:    req.RequestID,
					ComponentKey: key,
					Error:        errMsg,
				})
				a.mu.Unlock()
			}
			continue
		}

		// Launch sampling goroutines — one per component key so they don't block
		// the main poll/heartbeat loop.
		for _, key := range req.ComponentKeys {
			go func(reqID string, apiPort int, componentKey string, limit int) {
				slog.Debug("sampling component", "requestId", reqID, "component", componentKey)
				result := sampler.Sample(a.cfg.VectorBin, apiPort, componentKey, limit)
				result.RequestID = reqID

				msg := client.SampleResultMsg{
					RequestID:    result.RequestID,
					ComponentKey: result.ComponentKey,
					Events:       result.Events,
					Error:        result.Error,
				}
				// Convert FieldInfo to FieldInfoMsg
				for _, fi := range result.Schema {
					msg.Schema = append(msg.Schema, client.FieldInfoMsg{
						Path:   fi.Path,
						Type:   fi.Type,
						Sample: fi.Sample,
					})
				}

				a.mu.Lock()
				a.sampleResults = append(a.sampleResults, msg)
				a.mu.Unlock()

				slog.Debug("sample complete", "requestId", reqID, "component", componentKey, "events", len(result.Events))
			}(req.RequestID, s.APIPort, key, req.Limit)
		}
	}
}
