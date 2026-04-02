package agent

import (
	"testing"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/supervisor"
)

func TestBuildHeartbeatIncludesRunningAs(t *testing.T) {
	sup := supervisor.New("/usr/local/bin/vector")
	hb := buildHeartbeat(sup, "0.54.0", "STANDALONE", nil, nil, "testuser")
	if hb.RunningAs != "testuser" {
		t.Errorf("expected RunningAs=%q, got %q", "testuser", hb.RunningAs)
	}
}

func TestBuildHeartbeatRunningAsEmpty(t *testing.T) {
	sup := supervisor.New("/usr/local/bin/vector")
	hb := buildHeartbeat(sup, "0.54.0", "STANDALONE", nil, nil, "")
	if hb.RunningAs != "" {
		t.Errorf("expected RunningAs=%q, got %q", "", hb.RunningAs)
	}
}

func TestBuildHeartbeatRunningAsInPayload(t *testing.T) {
	sup := supervisor.New("/usr/local/bin/vector")
	hb := buildHeartbeat(sup, "0.54.0", "DOCKER", []client.SampleResultMsg{}, map[string]string{"env": "prod"}, "root")
	if hb.RunningAs != "root" {
		t.Errorf("expected RunningAs=%q, got %q", "root", hb.RunningAs)
	}
	if hb.DeploymentMode != "DOCKER" {
		t.Errorf("expected DeploymentMode=%q, got %q", "DOCKER", hb.DeploymentMode)
	}
}
