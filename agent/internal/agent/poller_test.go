package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/config"
	"github.com/TerrifiedBug/vectorflow/agent/internal/selfmetrics"
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

func TestPoll_InvalidConfigDoesNotReplaceActiveConfigOrAdvanceKnownState(t *testing.T) {
	tmpDir := t.TempDir()
	pipelinesDir := filepath.Join(tmpDir, "pipelines")
	if err := os.MkdirAll(pipelinesDir, 0700); err != nil {
		t.Fatal(err)
	}

	configPath := filepath.Join(pipelinesDir, "pipeline-a.yaml")
	oldConfig := "sources: {}\nsinks: {}\n"
	if err := os.WriteFile(configPath, []byte(oldConfig), 0600); err != nil {
		t.Fatal(err)
	}

	p := &poller{
		cfg: &config.Config{DataDir: tmpDir},
		client: &mockConfigFetcher{resp: &client.ConfigResponse{
			Pipelines: []client.PipelineConfig{{
				PipelineID:   "pipeline-a",
				PipelineName: "Pipeline A",
				ConfigYaml:   "sources: [",
				Checksum:     "new-checksum",
				Version:      2,
			}},
		}},
		known: map[string]pipelineState{
			"pipeline-a": {checksum: "old-checksum", version: 1},
		},
	}

	if _, err := p.Poll(); err == nil {
		t.Fatal("expected invalid YAML error")
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != oldConfig {
		t.Fatalf("active config was replaced: got %q", string(data))
	}
	if got := p.known["pipeline-a"]; got.checksum != "old-checksum" || got.version != 1 {
		t.Fatalf("known state advanced after validation failure: %+v", got)
	}
}

func TestAgentPollAndApply_RestartFailureRetriesSameChecksumAndPreservesConfig(t *testing.T) {
	tmpDir := t.TempDir()
	pipelinesDir := filepath.Join(tmpDir, "pipelines")
	if err := os.MkdirAll(pipelinesDir, 0700); err != nil {
		t.Fatal(err)
	}

	configPath := filepath.Join(pipelinesDir, "pipeline-a.yaml")
	oldConfig := "sources: {}\nsinks: {}\n"
	if err := os.WriteFile(configPath, []byte(oldConfig), 0600); err != nil {
		t.Fatal(err)
	}

	fetcher := &mockConfigFetcher{resp: &client.ConfigResponse{
		Pipelines: []client.PipelineConfig{{
			PipelineID:   "pipeline-a",
			PipelineName: "Pipeline A",
			ConfigYaml:   "sources:\n  demo:\n    type: demo_logs\nsinks: {}\n",
			Checksum:     "new-checksum",
			Version:      2,
		}},
	}}
	p := &poller{
		cfg:    &config.Config{DataDir: tmpDir},
		client: fetcher,
		known: map[string]pipelineState{
			"pipeline-a": {checksum: "old-checksum", version: 1},
		},
	}
	sup := &mockSupervisor{restartErr: fmt.Errorf("start vector: boom")}
	a := &Agent{
		poller:     p,
		supervisor: sup,
		metrics:    selfmetrics.New(func() int { return 0 }),
	}

	a.pollAndApply()
	a.pollAndApply()

	sup.mu.Lock()
	restartCount := sup.restartCount
	sup.mu.Unlock()

	if restartCount != 2 {
		t.Fatalf("expected same checksum to be retried after failed restart, got %d restarts", restartCount)
	}
	if got := p.known["pipeline-a"]; got.checksum != "old-checksum" || got.version != 1 {
		t.Fatalf("known state advanced after restart failure: %+v", got)
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != oldConfig {
		t.Fatalf("active config was not restored after restart failure: got %q", string(data))
	}
}
