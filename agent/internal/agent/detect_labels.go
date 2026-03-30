package agent

import (
	"context"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

const labelPrefix = "vf.io/"

// DetectLabels returns auto-detected labels about the host environment.
// All keys are prefixed with "vf.io/" to distinguish them from user-applied labels.
func DetectLabels(deploymentMode string) map[string]string {
	labels := map[string]string{
		labelPrefix + "os":              runtime.GOOS,
		labelPrefix + "arch":            runtime.GOARCH,
		labelPrefix + "deployment-mode": deploymentMode,
	}

	if hostname, err := os.Hostname(); err == nil && hostname != "" {
		labels[labelPrefix+"hostname"] = hostname
	}

	detectCloudLabels(labels)

	return labels
}

// MergeLabels merges user-defined labels on top of auto-detected labels.
// User labels take priority over auto-detected labels on key conflicts.
func MergeLabels(auto, user map[string]string) map[string]string {
	merged := make(map[string]string, len(auto)+len(user))
	for k, v := range auto {
		merged[k] = v
	}
	for k, v := range user {
		merged[k] = v
	}
	return merged
}

// detectCloudLabels probes cloud provider metadata APIs to discover
// cloud-specific labels. Each provider is tried with a short timeout;
// non-cloud hosts fall through quickly.
func detectCloudLabels(labels map[string]string) {
	// Try providers sequentially with short timeouts.
	// On a non-cloud host each probe takes ~200ms to timeout.
	if detectAWS(labels) {
		return
	}
	if detectGCP(labels) {
		return
	}
	detectAzure(labels)
}

func detectAWS(labels map[string]string) bool {
	// IMDSv2: get session token first
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	tokenReq, err := http.NewRequestWithContext(ctx, "PUT", "http://169.254.169.254/latest/api/token", nil)
	if err != nil {
		return false
	}
	tokenReq.Header.Set("X-aws-ec2-metadata-token-ttl-seconds", "21600")

	resp, err := http.DefaultClient.Do(tokenReq)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	tokenBytes, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != http.StatusOK {
		return false
	}
	token := strings.TrimSpace(string(tokenBytes))

	labels[labelPrefix+"cloud-provider"] = "aws"

	awsMeta := map[string]string{
		"cloud-region":        "/latest/meta-data/placement/region",
		"cloud-zone":          "/latest/meta-data/placement/availability-zone",
		"cloud-instance-type": "/latest/meta-data/instance-type",
		"cloud-instance-id":   "/latest/meta-data/instance-id",
	}
	for labelKey, path := range awsMeta {
		if val := fetchAWSMeta(token, path); val != "" {
			labels[labelPrefix+labelKey] = val
		}
	}
	return true
}

func fetchAWSMeta(token, path string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", "http://169.254.169.254"+path, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("X-aws-ec2-metadata-token", token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ""
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(body))
}

func detectGCP(labels map[string]string) bool {
	region := fetchGCPMeta("/computeMetadata/v1/instance/zone")
	if region == "" {
		return false
	}

	labels[labelPrefix+"cloud-provider"] = "gcp"

	// Zone comes back as "projects/<num>/zones/<zone>", extract the zone part
	if parts := strings.Split(region, "/"); len(parts) > 0 {
		zone := parts[len(parts)-1]
		labels[labelPrefix+"cloud-zone"] = zone
		// Region is zone minus the last segment (e.g. us-central1-a → us-central1)
		if idx := strings.LastIndex(zone, "-"); idx > 0 {
			labels[labelPrefix+"cloud-region"] = zone[:idx]
		}
	}

	if machineType := fetchGCPMeta("/computeMetadata/v1/instance/machine-type"); machineType != "" {
		if parts := strings.Split(machineType, "/"); len(parts) > 0 {
			labels[labelPrefix+"cloud-instance-type"] = parts[len(parts)-1]
		}
	}

	if instanceID := fetchGCPMeta("/computeMetadata/v1/instance/id"); instanceID != "" {
		labels[labelPrefix+"cloud-instance-id"] = instanceID
	}

	return true
}

func fetchGCPMeta(path string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", "http://169.254.169.254"+path, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Metadata-Flavor", "Google")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ""
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(body))
}

func detectAzure(labels map[string]string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET",
		"http://169.254.169.254/metadata/instance/compute/location?api-version=2021-02-01&format=text", nil)
	if err != nil {
		return false
	}
	req.Header.Set("Metadata", "true")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false
	}
	location := strings.TrimSpace(string(body))
	if location == "" {
		return false
	}

	labels[labelPrefix+"cloud-provider"] = "azure"
	labels[labelPrefix+"cloud-region"] = location

	if vmSize := fetchAzureMeta("vmSize"); vmSize != "" {
		labels[labelPrefix+"cloud-instance-type"] = vmSize
	}
	if vmID := fetchAzureMeta("vmId"); vmID != "" {
		labels[labelPrefix+"cloud-instance-id"] = vmID
	}

	return true
}

func fetchAzureMeta(field string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET",
		"http://169.254.169.254/metadata/instance/compute/"+field+"?api-version=2021-02-01&format=text", nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Metadata", "true")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ""
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(body))
}
