package tapper

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func assertTapResultRoundTrip(t *testing.T, fixtureName string, assert func(TapResult)) {
	t.Helper()

	data, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "agent", "v1", "fixtures", fixtureName))
	if err != nil {
		t.Fatalf("read tap fixture %s: %v", fixtureName, err)
	}

	var payload TapResult
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("unmarshal %s into Go struct: %v", fixtureName, err)
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal %s from Go struct: %v", fixtureName, err)
	}

	var original map[string]any
	var roundTripped map[string]any
	if err := json.Unmarshal(data, &original); err != nil {
		t.Fatalf("unmarshal original %s as map: %v", fixtureName, err)
	}
	if err := json.Unmarshal(encoded, &roundTripped); err != nil {
		t.Fatalf("unmarshal round-tripped %s as map: %v", fixtureName, err)
	}
	if !reflect.DeepEqual(original, roundTripped) {
		t.Fatalf("tap fixture %s did not round-trip through Go struct\noriginal: %#v\nround-tripped: %#v", fixtureName, original, roundTripped)
	}

	assert(payload)
}

func TestTapEventMatchesAgentV1ContractFixture(t *testing.T) {
	assertTapResultRoundTrip(t, "tap-event-request.json", func(payload TapResult) {
		if payload.RequestID != "tap-1" || payload.ComponentID != "demo" {
			t.Fatalf("tap event mismatch: %#v", payload)
		}
		if len(payload.Events) != 1 {
			t.Fatalf("expected one tap event, got %d", len(payload.Events))
		}
	})
}

func TestTapStoppedMatchesAgentV1ContractFixture(t *testing.T) {
	assertTapResultRoundTrip(t, "tap-stopped-request.json", func(payload TapResult) {
		if payload.Status != "stopped" || payload.Reason != "cancelled" {
			t.Fatalf("tap stopped mismatch: %#v", payload)
		}
	})
}
