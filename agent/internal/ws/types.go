package ws

// PushMessage is the envelope for all server→agent push messages.
// The Type field determines which concrete fields are populated.
//
// Fields are shared across message types:
//   - PipelineID: used by config_changed, sample_request
//   - Checksum: used by action (self_update)
type PushMessage struct {
	Type string `json:"type"`

	// config_changed fields
	PipelineID string `json:"pipelineId,omitempty"`
	Reason     string `json:"reason,omitempty"`

	// sample_request fields
	RequestID     string   `json:"requestId,omitempty"`
	ComponentKeys []string `json:"componentKeys,omitempty"`
	Limit         int      `json:"limit,omitempty"`

	// action fields
	Action        string `json:"action,omitempty"`
	TargetVersion string `json:"targetVersion,omitempty"`
	DownloadURL   string `json:"downloadUrl,omitempty"`
	Checksum      string `json:"checksum,omitempty"`

	// poll_interval fields
	IntervalMs int `json:"intervalMs,omitempty"`
}
