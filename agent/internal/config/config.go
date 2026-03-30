package config

import (
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"
)

type Config struct {
	URL          string
	Token        string
	DataDir      string
	VectorBin    string
	PollInterval time.Duration
	LogLevel     string
	SlogLevel    slog.Level
	NodeLabels   map[string]string
}

// parseNodeLabels parses a comma-separated "key=value,key2=value2" string
// into a map. Entries without "=" or with empty keys are skipped.
func parseNodeLabels(raw string) map[string]string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	labels := make(map[string]string)
	for _, pair := range strings.Split(raw, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		k, v, ok := strings.Cut(pair, "=")
		k = strings.TrimSpace(k)
		if !ok || k == "" {
			continue
		}
		labels[k] = strings.TrimSpace(v)
	}
	if len(labels) == 0 {
		return nil
	}
	return labels
}

func Load() (*Config, error) {
	url := os.Getenv("VF_URL")
	if url == "" {
		return nil, fmt.Errorf("VF_URL is required")
	}
	token := os.Getenv("VF_TOKEN")
	// Token can be empty if already enrolled (node-token file exists)

	dataDir := os.Getenv("VF_DATA_DIR")
	if dataDir == "" {
		dataDir = "/var/lib/vf-agent"
	}

	vectorBin := os.Getenv("VF_VECTOR_BIN")
	if vectorBin == "" {
		vectorBin = "vector"
	}

	pollStr := os.Getenv("VF_POLL_INTERVAL")
	poll := 5 * time.Second
	if pollStr != "" {
		var err error
		poll, err = time.ParseDuration(pollStr)
		if err != nil {
			return nil, fmt.Errorf("invalid VF_POLL_INTERVAL: %w", err)
		}
	}

	logLevel := os.Getenv("VF_LOG_LEVEL")
	if logLevel == "" {
		logLevel = "info"
	}

	var slogLevel slog.Level
	switch strings.ToLower(logLevel) {
	case "debug":
		slogLevel = slog.LevelDebug
	case "info":
		slogLevel = slog.LevelInfo
	case "warn", "warning":
		slogLevel = slog.LevelWarn
	case "error":
		slogLevel = slog.LevelError
	default:
		slogLevel = slog.LevelInfo
	}

	nodeLabels := parseNodeLabels(os.Getenv("VF_NODE_LABELS"))

	return &Config{
		URL:          url,
		Token:        token,
		DataDir:      dataDir,
		VectorBin:    vectorBin,
		PollInterval: poll,
		LogLevel:     logLevel,
		SlogLevel:    slogLevel,
		NodeLabels:   nodeLabels,
	}, nil
}
