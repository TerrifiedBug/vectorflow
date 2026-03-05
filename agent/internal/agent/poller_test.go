package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/config"
)

type mockConfigFetcher struct {
	resp *client.ConfigResponse
}

func (m *mockConfigFetcher) GetConfig() (*client.ConfigResponse, error) {
	return m.resp, nil
}

func TestPoll_RemovesOrphanedPipelineFiles(t *testing.T) {
	tmpDir := t.TempDir()
	pipelinesDir := filepath.Join(tmpDir, "pipelines")
	os.MkdirAll(pipelinesDir, 0700)

	// Pre-existing files: one valid pipeline, one orphan, one orphan with metrics sidecar
	os.WriteFile(filepath.Join(pipelinesDir, "pipeline-a.yaml"), []byte("valid"), 0600)
	os.WriteFile(filepath.Join(pipelinesDir, "orphan-b.yaml"), []byte("stale"), 0600)
	os.WriteFile(filepath.Join(pipelinesDir, "orphan-b.yaml.vf-metrics.yaml"), []byte("stale-metrics"), 0600)
	os.WriteFile(filepath.Join(pipelinesDir, "orphan-c.yaml"), []byte("stale2"), 0600)
	// Non-yaml file should be left alone
	os.WriteFile(filepath.Join(pipelinesDir, "notes.txt"), []byte("keep"), 0600)

	mc := &mockConfigFetcher{
		resp: &client.ConfigResponse{
			Pipelines: []client.PipelineConfig{
				{
					PipelineID:   "pipeline-a",
					PipelineName: "Pipeline A",
					ConfigYaml:   "valid",
					Checksum:     "abc123",
					Version:      1,
				},
			},
		},
	}

	p := &poller{
		cfg:    &config.Config{DataDir: tmpDir},
		client: mc,
		known:  make(map[string]pipelineState),
	}

	actions, err := p.Poll()
	if err != nil {
		t.Fatalf("Poll() error: %v", err)
	}

	// pipeline-a should be started (new to known map)
	if len(actions) != 1 || actions[0].PipelineID != "pipeline-a" {
		t.Errorf("expected 1 start action for pipeline-a, got %d actions", len(actions))
	}

	// pipeline-a.yaml should still exist
	if _, err := os.Stat(filepath.Join(pipelinesDir, "pipeline-a.yaml")); err != nil {
		t.Error("pipeline-a.yaml should exist")
	}

	// orphan-b.yaml and its metrics sidecar should be deleted
	if _, err := os.Stat(filepath.Join(pipelinesDir, "orphan-b.yaml")); !os.IsNotExist(err) {
		t.Error("orphan-b.yaml should be deleted")
	}
	if _, err := os.Stat(filepath.Join(pipelinesDir, "orphan-b.yaml.vf-metrics.yaml")); !os.IsNotExist(err) {
		t.Error("orphan-b.yaml.vf-metrics.yaml should be deleted")
	}

	// orphan-c.yaml should be deleted
	if _, err := os.Stat(filepath.Join(pipelinesDir, "orphan-c.yaml")); !os.IsNotExist(err) {
		t.Error("orphan-c.yaml should be deleted")
	}

	// notes.txt (non-yaml) should be left alone
	if _, err := os.Stat(filepath.Join(pipelinesDir, "notes.txt")); err != nil {
		t.Error("notes.txt should still exist")
	}
}

func TestPoll_EmptyResponseCleansAllFiles(t *testing.T) {
	tmpDir := t.TempDir()
	pipelinesDir := filepath.Join(tmpDir, "pipelines")
	os.MkdirAll(pipelinesDir, 0700)

	os.WriteFile(filepath.Join(pipelinesDir, "old-a.yaml"), []byte("stale"), 0600)
	os.WriteFile(filepath.Join(pipelinesDir, "old-a.yaml.vf-metrics.yaml"), []byte("stale-metrics"), 0600)
	os.WriteFile(filepath.Join(pipelinesDir, "old-b.yaml"), []byte("stale"), 0600)

	mc := &mockConfigFetcher{
		resp: &client.ConfigResponse{
			Pipelines: []client.PipelineConfig{},
		},
	}

	p := &poller{
		cfg:    &config.Config{DataDir: tmpDir},
		client: mc,
		known:  make(map[string]pipelineState),
	}

	_, err := p.Poll()
	if err != nil {
		t.Fatalf("Poll() error: %v", err)
	}

	entries, _ := os.ReadDir(pipelinesDir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".yaml") {
			t.Errorf("expected all yaml files deleted, found: %s", e.Name())
		}
	}
}
