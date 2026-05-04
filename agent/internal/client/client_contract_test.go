package client

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func readContractFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "agent", "v1", "fixtures", name))
	if err != nil {
		t.Fatalf("read contract fixture %s: %v", name, err)
	}
	return data
}

func assertRoundTripJSON[T any](t *testing.T, fixtureName string, assert func(T)) {
	t.Helper()

	data := readContractFixture(t, fixtureName)
	var payload T
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("unmarshal %s into Go contract struct: %v", fixtureName, err)
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal %s from Go contract struct: %v", fixtureName, err)
	}

	var original any
	var roundTripped any
	if err := json.Unmarshal(data, &original); err != nil {
		t.Fatalf("unmarshal original %s as map: %v", fixtureName, err)
	}
	if err := json.Unmarshal(encoded, &roundTripped); err != nil {
		t.Fatalf("unmarshal round-tripped %s as map: %v", fixtureName, err)
	}
	if !reflect.DeepEqual(original, roundTripped) {
		t.Fatalf("fixture %s did not round-trip through Go struct\noriginal: %#v\nround-tripped: %#v", fixtureName, original, roundTripped)
	}

	assert(payload)
}

func TestConfigResponseMatchesAgentV1ContractFixture(t *testing.T) {
	assertRoundTripJSON(t, "config-response.json", func(payload ConfigResponse) {
		if payload.PollIntervalMs != 15000 {
			t.Fatalf("poll interval mismatch: %d", payload.PollIntervalMs)
		}
		if payload.SecretBackend != "BUILTIN" {
			t.Fatalf("secret backend mismatch: %s", payload.SecretBackend)
		}
		if len(payload.Pipelines) != 1 {
			t.Fatalf("expected one pipeline, got %d", len(payload.Pipelines))
		}
		if payload.Pipelines[0].CertFiles[0].Filename != "ca-bundle.pem" {
			t.Fatalf("cert file filename mismatch: %s", payload.Pipelines[0].CertFiles[0].Filename)
		}
		if payload.PendingAction == nil || payload.PendingAction.Type != "self_update" {
			t.Fatalf("pending action mismatch: %#v", payload.PendingAction)
		}
		if len(payload.SampleRequests) != 1 || payload.SampleRequests[0].ComponentKeys[0] != "demo" {
			t.Fatalf("sample request mismatch: %#v", payload.SampleRequests)
		}
	})
}

func TestHeartbeatRequestMatchesAgentV1ContractFixture(t *testing.T) {
	assertRoundTripJSON(t, "heartbeat-request.json", func(payload HeartbeatRequest) {
		if payload.AgentVersion != "2.0.0" {
			t.Fatalf("agent version mismatch: %s", payload.AgentVersion)
		}
		if payload.DeploymentMode != "DOCKER" {
			t.Fatalf("deployment mode mismatch: %s", payload.DeploymentMode)
		}
		if len(payload.Pipelines) != 1 {
			t.Fatalf("expected one pipeline, got %d", len(payload.Pipelines))
		}
		if payload.Pipelines[0].ComponentMetrics[0].LatencyMeanSeconds != 0.012 {
			t.Fatalf("latency mismatch: %f", payload.Pipelines[0].ComponentMetrics[0].LatencyMeanSeconds)
		}
		if payload.HostMetrics == nil || payload.HostMetrics.NetTxBytes != 8192 {
			t.Fatalf("host metrics mismatch: %#v", payload.HostMetrics)
		}
		if payload.AgentHealth == nil || !payload.AgentHealth.PushConnected {
			t.Fatalf("agent health mismatch: %#v", payload.AgentHealth)
		}
		if len(payload.SampleResults) != 1 || payload.SampleResults[0].Schema[0].Path != "message" {
			t.Fatalf("sample result mismatch: %#v", payload.SampleResults)
		}
	})
}

func TestLogBatchesMatchAgentV1ContractFixture(t *testing.T) {
	assertRoundTripJSON(t, "log-batches-request.json", func(payload []LogBatch) {
		if len(payload) != 1 {
			t.Fatalf("expected one log batch, got %d", len(payload))
		}
		if payload[0].PipelineID != "pipe-1" || len(payload[0].Lines) != 2 {
			t.Fatalf("log batch mismatch: %#v", payload[0])
		}
	})
}

func TestSampleResultsRequestMatchesAgentV1ContractFixture(t *testing.T) {
	assertRoundTripJSON(t, "sample-results-request.json", func(payload SampleResultsRequest) {
		if len(payload.Results) != 1 {
			t.Fatalf("expected one sample result, got %d", len(payload.Results))
		}
		if payload.Results[0].RequestID != "sample-1" || payload.Results[0].ComponentKey != "demo" {
			t.Fatalf("sample result mismatch: %#v", payload.Results[0])
		}
		if payload.Results[0].Schema[0].Type != "string" {
			t.Fatalf("sample result schema mismatch: %#v", payload.Results[0].Schema)
		}
	})
}
