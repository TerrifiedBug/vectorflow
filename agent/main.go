package main

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/TerrifiedBug/vectorflow/agent/internal/agent"
	"github.com/TerrifiedBug/vectorflow/agent/internal/config"
)

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version", "-v":
			fmt.Printf("vf-agent %s\n", agent.Version)
			os.Exit(0)
		case "--help", "-h":
			fmt.Print(`VectorFlow Agent

Usage: vf-agent [flags]

Flags:
  --version, -v   Print version and exit
  --help, -h      Show this help

Environment variables:
  VF_URL            Server URL (required)
  VF_TOKEN          Enrollment token
  VF_DATA_DIR       Data directory (default: /var/lib/vf-agent)
  VF_VECTOR_BIN     Path to Vector binary (default: vector)
  VF_POLL_INTERVAL  Poll interval duration before server settings load (default: 5s)
  VF_LOG_FLUSH_INTERVAL  Log flush interval duration (default: 2s)
  VF_LOG_LEVEL      Log level: debug|info|warn|error (default: info)
  VF_NODE_LABELS    Node labels as comma-separated key=value pairs
  VF_METRICS_PORT   Port for agent self-metrics Prometheus endpoint (default: 9090, 0 = disabled)
`)
			os.Exit(0)
		}
	}

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config error: %v\n", err)
		os.Exit(1)
	}

	handler := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: cfg.SlogLevel,
	})
	slog.SetDefault(slog.New(handler))

	a, err := agent.New(cfg)
	if err != nil {
		slog.Error("init error", "error", err)
		os.Exit(1)
	}

	if err := a.Run(); err != nil {
		slog.Error("agent error", "error", err)
		os.Exit(1)
	}
}
