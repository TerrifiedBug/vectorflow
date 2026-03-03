package agent

import (
	"os"
	"strings"
)

// DetectDeploymentMode returns "DOCKER" if the agent appears to be running
// inside a container (Docker, containerd, Kubernetes), or "STANDALONE" otherwise.
func DetectDeploymentMode() string {
	// Check for Docker
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return "DOCKER"
	}
	// Check cgroup for container indicators
	data, err := os.ReadFile("/proc/1/cgroup")
	if err == nil {
		s := string(data)
		if strings.Contains(s, "docker") || strings.Contains(s, "containerd") || strings.Contains(s, "kubepods") {
			return "DOCKER"
		}
	}
	return "STANDALONE"
}
