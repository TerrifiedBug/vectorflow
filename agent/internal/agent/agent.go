package agent

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/vectorflow/agent/internal/client"
	"github.com/vectorflow/agent/internal/config"
	"github.com/vectorflow/agent/internal/supervisor"
)

const Version = "0.1.0"

type Agent struct {
	cfg           *config.Config
	client        *client.Client
	poller        *poller
	supervisor    *supervisor.Supervisor
	vectorVersion string
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
		cfg:           cfg,
		client:        c,
		poller:        newPoller(cfg, c),
		supervisor:    sup,
		vectorVersion: vectorVersion,
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
}

func (a *Agent) sendHeartbeat() {
	hb := buildHeartbeat(a.supervisor, a.vectorVersion)
	if err := a.client.SendHeartbeat(hb); err != nil {
		slog.Warn("heartbeat error", "error", err)
	}
}
