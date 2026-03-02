package sampler

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"
)

// SampleRequest is received from the server via config poll.
type SampleRequest struct {
	RequestID     string   `json:"requestId"`
	PipelineID    string   `json:"pipelineId"`
	ComponentKeys []string `json:"componentKeys"`
	Limit         int      `json:"limit"`
}

// SampleResult contains sampled events and extracted schema for one component.
type SampleResult struct {
	RequestID    string        `json:"requestId"`
	ComponentKey string        `json:"componentKey"`
	Events       []interface{} `json:"events"`
	Schema       []FieldInfo   `json:"schema"`
	Error        string        `json:"error,omitempty"`
}

const tapTimeout = 15 * time.Second

// Sample runs `vector tap` to capture live events from a running Vector instance
// and returns the collected events along with their merged schema.
func Sample(vectorBin string, apiPort int, componentKey string, limit int) SampleResult {
	ctx, cancel := context.WithTimeout(context.Background(), tapTimeout)
	defer cancel()

	url := fmt.Sprintf("http://127.0.0.1:%d/graphql", apiPort)

	cmd := exec.CommandContext(ctx, vectorBin, "tap",
		"--outputs-of", componentKey,
		"--url", url,
		"--format", "json",
		"--limit", fmt.Sprintf("%d", limit),
		"--duration_ms", "15000",
		"--quiet",
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return SampleResult{
			ComponentKey: componentKey,
			Error:        fmt.Sprintf("failed to create stdout pipe: %v", err),
		}
	}

	if err := cmd.Start(); err != nil {
		return SampleResult{
			ComponentKey: componentKey,
			Error:        fmt.Sprintf("failed to start vector tap: %v", err),
		}
	}

	var events []interface{}
	var schemas [][]FieldInfo

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Bytes()

		var parsed map[string]interface{}
		if err := json.Unmarshal(line, &parsed); err != nil {
			// Skip non-JSON lines.
			continue
		}

		events = append(events, parsed)
		schemas = append(schemas, ExtractSchema(parsed, 10))

		if len(events) >= limit {
			break
		}
	}

	// Wait for the process to finish (or be killed by context).
	_ = cmd.Wait()

	if len(events) == 0 {
		return SampleResult{
			ComponentKey: componentKey,
			Error:        "timeout: no events received within 15s",
		}
	}

	return SampleResult{
		ComponentKey: componentKey,
		Events:       events,
		Schema:       MergeSchemas(schemas),
	}
}
