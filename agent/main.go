package main

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/vectorflow/agent/internal/agent"
	"github.com/vectorflow/agent/internal/config"
)

func main() {
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
