package agent

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/config"
)

type configFetcher interface {
	GetConfig() (*client.ConfigResponse, error)
}

type pipelineState struct {
	checksum string
	version  int
}

type poller struct {
	cfg            *config.Config
	client         configFetcher
	mu             sync.Mutex
	known          map[string]pipelineState // pipelineId -> last known state
	sampleRequests []client.SampleRequestMsg
	pendingAction  *client.PendingAction
	websocketUrl   string
}

func newPoller(cfg *config.Config, c configFetcher) *poller {
	return &poller{
		cfg:    cfg,
		client: c,
		known:  make(map[string]pipelineState),
	}
}

type Action int

const (
	ActionNoop Action = iota
	ActionStart
	ActionRestart
	ActionStop
	ActionUpdateVersion
)

type PipelineAction struct {
	Action     Action
	PipelineID string
	Name       string
	Version    int
	ConfigPath string
	LogLevel   string
	Secrets    map[string]string
}

// Poll fetches config from VectorFlow and returns actions to take.
func (p *poller) Poll() ([]PipelineAction, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	resp, err := p.client.GetConfig()
	if err != nil {
		return nil, err
	}

	var actions []PipelineAction
	seen := make(map[string]bool)

	pipelinesDir := filepath.Join(p.cfg.DataDir, "pipelines")
	certsDir := filepath.Join(p.cfg.DataDir, "certs")
	os.MkdirAll(pipelinesDir, 0700)
	os.MkdirAll(certsDir, 0700)

	for _, pc := range resp.Pipelines {
		seen[pc.PipelineID] = true
		configPath := filepath.Join(pipelinesDir, pc.PipelineID+".yaml")

		// Write cert files if present
		for _, cf := range pc.CertFiles {
			// Sanitize filename to prevent path traversal
			safeName := filepath.Base(cf.Filename)
			if safeName == "." || safeName == ".." || safeName == string(filepath.Separator) {
				slog.Warn("rejected unsafe cert filename", "cert", cf.Name, "filename", cf.Filename)
				continue
			}
			certPath := filepath.Join(certsDir, safeName)
			data, err := base64.StdEncoding.DecodeString(cf.Data)
			if err != nil {
				slog.Warn("failed to decode cert", "cert", cf.Name, "error", err)
				continue
			}
			if err := os.WriteFile(certPath, data, 0600); err != nil {
				slog.Warn("failed to write cert", "path", certPath, "error", err)
			}
		}

		prev, exists := p.known[pc.PipelineID]
		if !exists {
			// New pipeline — write config and start
			if err := os.WriteFile(configPath, []byte(pc.ConfigYaml), 0600); err != nil {
				return nil, fmt.Errorf("write config %s: %w", configPath, err)
			}
			p.known[pc.PipelineID] = pipelineState{checksum: pc.Checksum, version: pc.Version}
			actions = append(actions, PipelineAction{
				Action:     ActionStart,
				PipelineID: pc.PipelineID,
				Name:       pc.PipelineName,
				Version:    pc.Version,
				ConfigPath: configPath,
				LogLevel:   pc.LogLevel,
				Secrets:    pc.Secrets,
			})
		} else if prev.checksum != pc.Checksum {
			// Config changed — rewrite and restart
			if err := os.WriteFile(configPath, []byte(pc.ConfigYaml), 0600); err != nil {
				return nil, fmt.Errorf("write config %s: %w", configPath, err)
			}
			p.known[pc.PipelineID] = pipelineState{checksum: pc.Checksum, version: pc.Version}
			actions = append(actions, PipelineAction{
				Action:     ActionRestart,
				PipelineID: pc.PipelineID,
				Name:       pc.PipelineName,
				Version:    pc.Version,
				ConfigPath: configPath,
				LogLevel:   pc.LogLevel,
				Secrets:    pc.Secrets,
			})
		} else if prev.version != pc.Version {
			// Version bumped but config unchanged — update version without restart
			p.known[pc.PipelineID] = pipelineState{checksum: pc.Checksum, version: pc.Version}
			actions = append(actions, PipelineAction{
				Action:     ActionUpdateVersion,
				PipelineID: pc.PipelineID,
				Name:       pc.PipelineName,
				Version:    pc.Version,
			})
		}
	}

	// Stop pipelines that are no longer in the config
	for id := range p.known {
		if !seen[id] {
			actions = append(actions, PipelineAction{
				Action:     ActionStop,
				PipelineID: id,
			})
			delete(p.known, id)
			// Clean up config file
			os.Remove(filepath.Join(pipelinesDir, id+".yaml"))
		}
	}

	// Reconcile: remove any pipeline files on disk not in the server response.
	// This catches orphans from previous enrollments or missed undeploys.
	entries, readErr := os.ReadDir(pipelinesDir)
	if readErr != nil {
		slog.Warn("failed to read pipelines dir for reconciliation", "error", readErr)
	} else {
		for _, entry := range entries {
			name := entry.Name()
			if strings.HasSuffix(name, ".vf-metrics.yaml") {
				continue
			}
			if !strings.HasSuffix(name, ".yaml") {
				continue
			}
			id := strings.TrimSuffix(name, ".yaml")
			if !seen[id] {
				slog.Warn("removing orphaned pipeline config", "pipelineId", id)
				if err := os.Remove(filepath.Join(pipelinesDir, name)); err != nil && !os.IsNotExist(err) {
					slog.Warn("failed to remove orphaned pipeline config", "path", name, "error", err)
				}
				if err := os.Remove(filepath.Join(pipelinesDir, name+".vf-metrics.yaml")); err != nil && !os.IsNotExist(err) {
					slog.Warn("failed to remove orphaned metrics sidecar", "path", name+".vf-metrics.yaml", "error", err)
				}
			}
		}
	}

	// Store sample requests for the agent to process
	p.sampleRequests = resp.SampleRequests

	// Store pending action (e.g. self-update) for the agent to handle
	p.pendingAction = resp.PendingAction

	// Store websocket URL for the agent to use
	if resp.WebSocketURL != "" {
		p.websocketUrl = resp.WebSocketURL
	}

	return actions, nil
}

// SampleRequests returns the sample requests from the last poll response.
func (p *poller) SampleRequests() []client.SampleRequestMsg {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.sampleRequests
}

// PendingAction returns the pending action from the last poll response, if any.
func (p *poller) PendingAction() *client.PendingAction {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.pendingAction
}

// WebSocketURL returns the WebSocket URL from the last config response.
func (p *poller) WebSocketURL() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.websocketUrl
}
