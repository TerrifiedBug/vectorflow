package agent

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"os/user"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/config"
	"github.com/TerrifiedBug/vectorflow/agent/internal/sampler"
	"github.com/TerrifiedBug/vectorflow/agent/internal/supervisor"
	"github.com/TerrifiedBug/vectorflow/agent/internal/push"
)

var Version = "dev"

type Agent struct {
	cfg            *config.Config
	client         *client.Client
	poller         *poller
	supervisor     *supervisor.Supervisor
	vectorVersion  string
	deploymentMode string
	labels         map[string]string
	runningAs      string

	mu                  sync.Mutex
	sampleResults       []client.SampleResultMsg
	failedUpdateVersion string // skip retries for this version
	updateError         string // report failure to server

	pushClient           *push.Client
	pushCh               chan push.PushMessage
	immediateHeartbeat   *time.Timer
	immediateHeartbeatCh chan struct{}
}

func New(cfg *config.Config) (*Agent, error) {
	c := client.New(cfg.URL)
	sup := supervisor.New(cfg.VectorBin)

	// Detect Vector version
	vectorVersion := ""
	if out, err := exec.Command(cfg.VectorBin, "--version").Output(); err == nil {
		vectorVersion = strings.TrimSpace(string(out))
	}

	deploymentMode := DetectDeploymentMode()
	autoLabels := DetectLabels(deploymentMode)
	labels := MergeLabels(autoLabels, cfg.NodeLabels)

	var runningAs string
	if u, err := user.Current(); err == nil {
		runningAs = u.Username
	}

	return &Agent{
		cfg:            cfg,
		client:         c,
		poller:         newPoller(cfg, c),
		supervisor:     sup,
		vectorVersion:  vectorVersion,
		deploymentMode: deploymentMode,
		labels:         labels,
		runningAs:      runningAs,
	}, nil
}

func (a *Agent) Run() error {
	// Step 1: Enroll or load existing token
	nodeToken, err := loadOrEnroll(a.cfg, a.client, a.labels)
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
	currentInterval := a.cfg.PollInterval
	ticker := time.NewTicker(currentInterval)
	defer ticker.Stop()

	// Do first poll immediately
	a.pollAndApply()

	// Start SSE push client — prefer server-provided URL, fall back to derived URL
	a.pushCh = make(chan push.PushMessage, 16)
	a.immediateHeartbeatCh = make(chan struct{}, 1)
	pushURL := a.poller.PushURL()
	derivedURL := strings.TrimRight(a.cfg.URL, "/") + "/api/agent/push"
	if pushURL == "" {
		pushURL = derivedURL
		derivedURL = "" // no fallback needed when already using derived
	}
	a.pushClient = push.New(pushURL, derivedURL, a.client.NodeToken(), func(msg push.PushMessage) {
		select {
		case a.pushCh <- msg:
		default:
			slog.Warn("push: message channel full, dropping message", "type", msg.Type)
		}
	})
	go a.pushClient.Connect()
	slog.Info("push client started", "url", pushURL, "fallback", derivedURL)

	a.sendHeartbeat()
	currentInterval = a.maybeResetTicker(ticker, currentInterval)

	for {
		select {
		case <-ctx.Done():
			slog.Info("shutting down all pipelines")
			if a.pushClient != nil {
				a.pushClient.Close()
			}
			if a.immediateHeartbeat != nil {
				a.immediateHeartbeat.Stop()
			}
			a.supervisor.ShutdownAll()
			slog.Info("agent stopped")
			return nil
		case <-ticker.C:
			a.pollAndApply()
			a.sendHeartbeat()
			currentInterval = a.maybeResetTicker(ticker, currentInterval)
		case msg := <-a.pushCh:
			a.handlePushMessage(msg, ticker)
		case <-a.immediateHeartbeatCh:
			a.sendHeartbeat()
		}
	}
}

// maybeResetTicker checks if the server provided a new poll interval and resets
// the ticker if it changed. Returns the (possibly updated) current interval.
func (a *Agent) maybeResetTicker(ticker *time.Ticker, current time.Duration) time.Duration {
	serverMs := a.poller.PollIntervalMs()
	if serverMs <= 0 {
		return current
	}
	serverInterval := time.Duration(serverMs) * time.Millisecond
	if serverInterval != current {
		slog.Info("poll interval updated by server", "old", current, "new", serverInterval)
		ticker.Reset(serverInterval)
		return serverInterval
	}
	return current
}

func (a *Agent) pollAndApply() {
	actions, err := a.poller.Poll()
	if err != nil {
		slog.Warn("poll error", "error", err)
		return
	}

	slog.Debug("poll complete", "actions", len(actions))

	for _, action := range actions {
		switch action.Action {
		case ActionStart:
			slog.Info("starting pipeline", "name", action.Name, "version", action.Version)
			if err := a.supervisor.Start(action.PipelineID, action.ConfigPath, action.Version, action.LogLevel, action.Secrets); err != nil {
				slog.Error("failed to start pipeline", "pipeline", action.PipelineID, "error", err)
			} else if action.Checksum != "" {
				a.supervisor.SetConfigChecksum(action.PipelineID, action.Checksum)
			}
		case ActionRestart:
			slog.Info("restarting pipeline", "name", action.Name, "version", action.Version, "reason", "config changed")
			if err := a.supervisor.Restart(action.PipelineID, action.ConfigPath, action.Version, action.LogLevel, action.Secrets); err != nil {
				slog.Error("failed to restart pipeline", "pipeline", action.PipelineID, "error", err)
			} else if action.Checksum != "" {
				a.supervisor.SetConfigChecksum(action.PipelineID, action.Checksum)
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

	// Handle pending action (e.g. self-update)
	if action := a.poller.PendingAction(); action != nil {
		a.handlePendingAction(action)
	}
}

func (a *Agent) handlePendingAction(action *client.PendingAction) {
	switch action.Type {
	case "self_update":
		if a.deploymentMode == "DOCKER" {
			slog.Warn("received update command but running in Docker — ignoring",
				"targetVersion", action.TargetVersion)
			a.updateError = "running in Docker"
			return
		}
		if action.TargetVersion == Version {
			slog.Debug("already running target version, skipping update", "version", Version)
			return
		}
		if action.TargetVersion == a.failedUpdateVersion {
			return // already failed for this version, don't retry
		}
		if err := a.handleSelfUpdate(action); err != nil {
			slog.Error("self-update failed", "error", err)
			a.failedUpdateVersion = action.TargetVersion
			a.updateError = err.Error()
		}
	default:
		slog.Warn("unknown pending action type", "type", action.Type)
	}
}

func (a *Agent) sendHeartbeat() {
	// Drain accumulated sample results under lock
	a.mu.Lock()
	results := a.sampleResults
	a.sampleResults = nil
	a.mu.Unlock()

	hb := buildHeartbeat(a.supervisor, a.vectorVersion, a.deploymentMode, results, a.labels, a.runningAs)
	updateErr := a.updateError
	if updateErr != "" {
		hb.UpdateError = updateErr
	}
	if err := a.client.SendHeartbeat(hb); err != nil {
		slog.Warn("heartbeat error", "error", err)
		// Put results back so they retry on the next heartbeat
		if len(results) > 0 {
			a.mu.Lock()
			a.sampleResults = append(results, a.sampleResults...)
			a.mu.Unlock()
		}
	} else {
		a.updateError = "" // clear only after successful delivery
		slog.Debug("heartbeat sent", "pipelines", len(hb.Pipelines), "sampleResults", len(results))
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

// handlePushMessage processes a push message from the SSE push channel.
// MUST be called from the main goroutine (same goroutine as Run()'s select loop).
func (a *Agent) handlePushMessage(msg push.PushMessage, ticker *time.Ticker) {
	switch msg.Type {
	case "config_changed":
		slog.Info("push: config changed notification", "pipeline", msg.PipelineID, "reason", msg.Reason)
		// Re-poll immediately to get the full assembled config
		a.pollAndApply()
		a.triggerImmediateHeartbeat()

	case "sample_request":
		slog.Info("push: sample request received", "requestId", msg.RequestID, "pipeline", msg.PipelineID)
		a.processSampleRequestsAndSend([]client.SampleRequestMsg{
			{
				RequestID:     msg.RequestID,
				PipelineID:    msg.PipelineID,
				ComponentKeys: msg.ComponentKeys,
				Limit:         msg.Limit,
			},
		})

	case "action":
		slog.Info("push: action received", "action", msg.Action)
		switch msg.Action {
		case "self_update":
			a.handlePendingAction(&client.PendingAction{
				Type:          "self_update",
				TargetVersion: msg.TargetVersion,
				DownloadURL:   msg.DownloadURL,
				Checksum:      msg.Checksum,
			})
			a.triggerImmediateHeartbeat()
		case "restart":
			slog.Warn("push: restart action not yet implemented, triggering re-poll instead")
			a.pollAndApply()
			a.triggerImmediateHeartbeat()
		default:
			slog.Warn("push: unknown action", "action", msg.Action)
		}

	case "poll_interval":
		if msg.IntervalMs > 0 {
			newInterval := time.Duration(msg.IntervalMs) * time.Millisecond
			ticker.Reset(newInterval)
			slog.Info("push: poll interval changed", "intervalMs", msg.IntervalMs)
		}

	default:
		slog.Warn("push: unknown message type", "type", msg.Type)
	}
}

// triggerImmediateHeartbeat sends a heartbeat soon, debounced to 1 second.
// Multiple calls within 1s collapse into a single heartbeat with the latest state.
// The timer fires a signal back to the main goroutine's select loop, ensuring
// sendHeartbeat() always runs on the main goroutine (no data race on updateError).
// MUST be called from the main goroutine.
func (a *Agent) triggerImmediateHeartbeat() {
	if a.immediateHeartbeat != nil {
		a.immediateHeartbeat.Stop()
	}
	a.immediateHeartbeat = time.AfterFunc(time.Second, func() {
		select {
		case a.immediateHeartbeatCh <- struct{}{}:
		default:
		}
	})
}

// processSampleRequestsAndSend processes sample requests and sends results
// directly to the /api/agent/samples endpoint (used for push-triggered requests).
// Falls back to heartbeat delivery on HTTP failure.
func (a *Agent) processSampleRequestsAndSend(requests []client.SampleRequestMsg) {
	statuses := a.supervisor.Statuses()
	statusMap := make(map[string]supervisor.ProcessInfo, len(statuses))
	for _, s := range statuses {
		statusMap[s.PipelineID] = s
	}

	for _, req := range requests {
		s, found := statusMap[req.PipelineID]
		if !found || s.Status != "RUNNING" || s.APIPort == 0 {
			errMsg := "pipeline not running"
			if !found {
				errMsg = "pipeline not found"
			} else if s.APIPort == 0 {
				errMsg = "pipeline API port not available"
			}
			results := make([]client.SampleResultMsg, 0, len(req.ComponentKeys))
			for _, key := range req.ComponentKeys {
				results = append(results, client.SampleResultMsg{
					RequestID:    req.RequestID,
					ComponentKey: key,
					Error:        errMsg,
				})
			}
			if err := a.client.SendSampleResults(results); err != nil {
				slog.Warn("failed to send sample error results via dedicated endpoint", "error", err)
				a.mu.Lock()
				a.sampleResults = append(a.sampleResults, results...)
				a.mu.Unlock()
			}
			continue
		}

		for _, key := range req.ComponentKeys {
			go func(reqID string, apiPort int, componentKey string, limit int) {
				result := sampler.Sample(a.cfg.VectorBin, apiPort, componentKey, limit)
				result.RequestID = reqID

				msg := client.SampleResultMsg{
					RequestID:    result.RequestID,
					ComponentKey: result.ComponentKey,
					Events:       result.Events,
					Error:        result.Error,
				}
				for _, fi := range result.Schema {
					msg.Schema = append(msg.Schema, client.FieldInfoMsg{
						Path: fi.Path, Type: fi.Type, Sample: fi.Sample,
					})
				}

				if err := a.client.SendSampleResults([]client.SampleResultMsg{msg}); err != nil {
					slog.Warn("failed to send sample results via dedicated endpoint, will retry in heartbeat", "error", err)
					a.mu.Lock()
					a.sampleResults = append(a.sampleResults, msg)
					a.mu.Unlock()
				} else {
					slog.Debug("sample result sent via dedicated endpoint", "requestId", reqID, "component", componentKey)
				}
			}(req.RequestID, s.APIPort, key, req.Limit)
		}
	}
}
