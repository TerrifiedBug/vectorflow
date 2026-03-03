package agent

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/config"
)

const nodeTokenFile = "node-token"

// loadOrEnroll returns the node token, either from disk or by enrolling.
func loadOrEnroll(cfg *config.Config, c *client.Client) (string, error) {
	tokenPath := filepath.Join(cfg.DataDir, nodeTokenFile)

	// Try loading existing token
	data, err := os.ReadFile(tokenPath)
	if err == nil {
		token := strings.TrimSpace(string(data))
		if token != "" {
			return token, nil
		}
	}

	// Need to enroll
	if cfg.Token == "" {
		return "", fmt.Errorf("no node token found at %s and VF_TOKEN is not set — cannot enroll", tokenPath)
	}

	hostname, _ := os.Hostname()
	vectorVersion := detectVectorVersion(cfg.VectorBin)

	resp, err := c.Enroll(client.EnrollRequest{
		Token:         cfg.Token,
		Hostname:      hostname,
		OS:            runtime.GOOS + "/" + runtime.GOARCH,
		AgentVersion:  Version,
		VectorVersion: vectorVersion,
	})
	if err != nil {
		return "", fmt.Errorf("enrollment failed: %w", err)
	}

	// Persist node token
	if err := os.MkdirAll(cfg.DataDir, 0700); err != nil {
		return "", fmt.Errorf("create data dir: %w", err)
	}
	if err := os.WriteFile(tokenPath, []byte(resp.NodeToken), 0600); err != nil {
		return "", fmt.Errorf("persist node token: %w", err)
	}

	fmt.Printf("Enrolled as node %s in environment %q\n", resp.NodeID, resp.EnvironmentName)
	return resp.NodeToken, nil
}

func detectVectorVersion(vectorBin string) string {
	out, err := exec.Command(vectorBin, "--version").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
