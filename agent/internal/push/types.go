package push

// PushMessage is a server→agent push message received over SSE.
// All fields are on a single struct with omitempty — the Type field
// discriminates which fields are populated.
type PushMessage struct {
	Type string `json:"type"`

	// config_changed fields
	PipelineID string `json:"pipelineId,omitempty"`
	Reason     string `json:"reason,omitempty"`

	// sample_request fields
	RequestID     string   `json:"requestId,omitempty"`
	ComponentKeys []string `json:"componentKeys,omitempty"`
	Limit         int      `json:"limit,omitempty"`

	// tap_start / tap_stop fields
	ComponentID string `json:"componentId,omitempty"`

	// action fields
	Action        string `json:"action,omitempty"`
	TargetVersion string `json:"targetVersion,omitempty"`
	DownloadURL   string `json:"downloadUrl,omitempty"`
	Checksum      string `json:"checksum,omitempty"`

	// poll_interval fields
	IntervalMs int `json:"intervalMs,omitempty"`
}
