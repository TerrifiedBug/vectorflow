package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	baseURL    string
	nodeToken  string
	httpClient *http.Client
}

func New(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) SetNodeToken(token string) {
	c.nodeToken = token
}

// EnrollRequest is sent to POST /api/agent/enroll
type EnrollRequest struct {
	Token         string `json:"token"`
	Hostname      string `json:"hostname"`
	OS            string `json:"os,omitempty"`
	AgentVersion  string `json:"agentVersion,omitempty"`
	VectorVersion string `json:"vectorVersion,omitempty"`
}

// EnrollResponse is returned from POST /api/agent/enroll
type EnrollResponse struct {
	NodeID          string `json:"nodeId"`
	NodeToken       string `json:"nodeToken"`
	EnvironmentID   string `json:"environmentId"`
	EnvironmentName string `json:"environmentName"`
}

func (c *Client) Enroll(req EnrollRequest) (*EnrollResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal enroll request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", c.baseURL+"/api/agent/enroll", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create enroll request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("enroll request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("enroll failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result EnrollResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode enroll response: %w", err)
	}
	return &result, nil
}

// PipelineConfig represents a single pipeline's configuration from the config endpoint
type PipelineConfig struct {
	PipelineID   string            `json:"pipelineId"`
	PipelineName string            `json:"pipelineName"`
	Version      int               `json:"version"`
	ConfigYaml   string            `json:"configYaml"`
	Checksum     string            `json:"checksum"`
	LogLevel     string            `json:"logLevel,omitempty"`
	Secrets      map[string]string `json:"secrets,omitempty"`
	CertFiles    []CertFile        `json:"certFiles,omitempty"`
}

type CertFile struct {
	Name     string `json:"name"`
	Filename string `json:"filename"`
	Data     string `json:"data"` // base64 encoded
}

// ConfigResponse is returned from GET /api/agent/config
type ConfigResponse struct {
	Pipelines           []PipelineConfig       `json:"pipelines"`
	PollIntervalMs      int                    `json:"pollIntervalMs"`
	SecretBackend       string                 `json:"secretBackend"`
	SecretBackendConfig map[string]interface{} `json:"secretBackendConfig,omitempty"`
	SampleRequests      []SampleRequestMsg     `json:"sampleRequests,omitempty"`
}

func (c *Client) GetConfig() (*ConfigResponse, error) {
	httpReq, err := http.NewRequest("GET", c.baseURL+"/api/agent/config", nil)
	if err != nil {
		return nil, fmt.Errorf("create config request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.nodeToken)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("config request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("config request failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result ConfigResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode config response: %w", err)
	}
	return &result, nil
}

// PipelineStatus is sent as part of the heartbeat
type PipelineStatus struct {
	PipelineID       string            `json:"pipelineId"`
	Version          int               `json:"version"`
	Status           string            `json:"status"` // RUNNING, STARTING, STOPPED, CRASHED, PENDING
	PID              int               `json:"pid,omitempty"`
	UptimeSeconds    int               `json:"uptimeSeconds,omitempty"`
	EventsIn         int64             `json:"eventsIn,omitempty"`
	EventsOut        int64             `json:"eventsOut,omitempty"`
	ErrorsTotal      int64             `json:"errorsTotal,omitempty"`
	BytesIn          int64             `json:"bytesIn,omitempty"`
	BytesOut         int64             `json:"bytesOut,omitempty"`
	EventsDiscarded  int64             `json:"eventsDiscarded,omitempty"`
	ComponentMetrics []ComponentMetric `json:"componentMetrics,omitempty"`
	Utilization      float64           `json:"utilization,omitempty"`
	RecentLogs       []string          `json:"recentLogs,omitempty"`
}

// ComponentMetric holds per-component metrics for editor node overlays.
type ComponentMetric struct {
	ComponentID     string `json:"componentId"`
	ComponentKind   string `json:"componentKind"`
	ReceivedEvents  int64  `json:"receivedEvents"`
	SentEvents      int64  `json:"sentEvents"`
	ReceivedBytes   int64  `json:"receivedBytes,omitempty"`
	SentBytes       int64  `json:"sentBytes,omitempty"`
	ErrorsTotal     int64  `json:"errorsTotal,omitempty"`
	DiscardedEvents int64  `json:"discardedEvents,omitempty"`
}

// HostMetrics holds system-level metrics from the Vector host
type HostMetrics struct {
	MemoryTotalBytes  int64   `json:"memoryTotalBytes"`
	MemoryUsedBytes   int64   `json:"memoryUsedBytes"`
	MemoryFreeBytes   int64   `json:"memoryFreeBytes"`
	CpuSecondsTotal   float64 `json:"cpuSecondsTotal"`
	LoadAvg1          float64 `json:"loadAvg1"`
	LoadAvg5          float64 `json:"loadAvg5"`
	LoadAvg15         float64 `json:"loadAvg15"`
	FsTotalBytes      int64   `json:"fsTotalBytes"`
	FsUsedBytes       int64   `json:"fsUsedBytes"`
	FsFreeBytes       int64   `json:"fsFreeBytes"`
	DiskReadBytes     int64   `json:"diskReadBytes"`
	DiskWrittenBytes  int64   `json:"diskWrittenBytes"`
	NetRxBytes        int64   `json:"netRxBytes"`
	NetTxBytes        int64   `json:"netTxBytes"`
}

// HeartbeatRequest is sent to POST /api/agent/heartbeat
type HeartbeatRequest struct {
	Pipelines     []PipelineStatus  `json:"pipelines"`
	HostMetrics   *HostMetrics      `json:"hostMetrics,omitempty"`
	AgentVersion  string            `json:"agentVersion,omitempty"`
	VectorVersion string            `json:"vectorVersion,omitempty"`
	SampleResults []SampleResultMsg `json:"sampleResults,omitempty"`
}

// SampleRequestMsg is received from the server via config poll.
type SampleRequestMsg struct {
	RequestID     string   `json:"requestId"`
	PipelineID    string   `json:"pipelineId"`
	ComponentKeys []string `json:"componentKeys"`
	Limit         int      `json:"limit"`
}

// SampleResultMsg contains sampled events and extracted schema for one component.
type SampleResultMsg struct {
	RequestID    string         `json:"requestId"`
	ComponentKey string         `json:"componentKey"`
	Events       []interface{}  `json:"events"`
	Schema       []FieldInfoMsg `json:"schema"`
	Error        string         `json:"error,omitempty"`
}

// FieldInfoMsg describes a single field discovered in a sampled event.
type FieldInfoMsg struct {
	Path   string `json:"path"`
	Type   string `json:"type"`
	Sample string `json:"sample"`
}

func (c *Client) SendHeartbeat(req HeartbeatRequest) error {
	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal heartbeat: %w", err)
	}

	httpReq, err := http.NewRequest("POST", c.baseURL+"/api/agent/heartbeat", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create heartbeat request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.nodeToken)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("heartbeat request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("heartbeat failed (status %d): %s", resp.StatusCode, string(respBody))
	}
	return nil
}
