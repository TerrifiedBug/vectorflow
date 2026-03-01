package agent

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/vectorflow/agent/internal/client"
	"github.com/vectorflow/agent/internal/config"
)

type pipelineState struct {
	checksum string
	version  int
}

type poller struct {
	cfg    *config.Config
	client *client.Client
	known  map[string]pipelineState // pipelineId -> last known state
}

func newPoller(cfg *config.Config, c *client.Client) *poller {
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
			certPath := filepath.Join(certsDir, cf.Filename)
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

	return actions, nil
}
