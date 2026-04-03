package agent

import (
	"testing"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/selfmetrics"
	"github.com/TerrifiedBug/vectorflow/agent/internal/supervisor"
)

func newTestMetrics() *selfmetrics.Metrics {
	return selfmetrics.New(nil)
}

func TestBuildHeartbeatIncludesRunningAs(t *testing.T) {
	sup := supervisor.New("/usr/local/bin/vector")
	hb := buildHeartbeat(sup, newTestMetrics(), "0.54.0", "STANDALONE", nil, nil, "testuser")
	if hb.RunningAs != "testuser" {
		t.Errorf("expected RunningAs=%q, got %q", "testuser", hb.RunningAs)
	}
}

func TestBuildHeartbeatRunningAsEmpty(t *testing.T) {
	sup := supervisor.New("/usr/local/bin/vector")
	hb := buildHeartbeat(sup, newTestMetrics(), "0.54.0", "STANDALONE", nil, nil, "")
	if hb.RunningAs != "" {
		t.Errorf("expected RunningAs=%q, got %q", "", hb.RunningAs)
	}
}

func TestBuildHeartbeatRunningAsInPayload(t *testing.T) {
	sup := supervisor.New("/usr/local/bin/vector")
	hb := buildHeartbeat(sup, newTestMetrics(), "0.54.0", "DOCKER", []client.SampleResultMsg{}, map[string]string{"env": "prod"}, "root")
	if hb.RunningAs != "root" {
		t.Errorf("expected RunningAs=%q, got %q", "root", hb.RunningAs)
	}
	if hb.DeploymentMode != "DOCKER" {
		t.Errorf("expected DeploymentMode=%q, got %q", "DOCKER", hb.DeploymentMode)
	}
}

func TestBuildHeartbeatIncludesAgentHealth(t *testing.T) {
	sup := supervisor.New("/usr/local/bin/vector")
	sm := newTestMetrics()
	sm.IncPollErrors()
	sm.IncPushReconnects()
	sm.IncPushReconnects()
	sm.SetPushConnected(true)

	hb := buildHeartbeat(sup, sm, "0.54.0", "STANDALONE", nil, nil, "testuser")
	if hb.AgentHealth == nil {
		t.Fatal("expected AgentHealth to be set")
	}
	if hb.AgentHealth.PollErrorsTotal != 1 {
		t.Errorf("expected PollErrorsTotal=1, got %d", hb.AgentHealth.PollErrorsTotal)
	}
	if hb.AgentHealth.PushReconnectsTotal != 2 {
		t.Errorf("expected PushReconnectsTotal=2, got %d", hb.AgentHealth.PushReconnectsTotal)
	}
	if !hb.AgentHealth.PushConnected {
		t.Error("expected PushConnected=true")
	}
	if hb.AgentHealth.UptimeSeconds < 0 {
		t.Errorf("expected non-negative UptimeSeconds, got %f", hb.AgentHealth.UptimeSeconds)
	}
}
