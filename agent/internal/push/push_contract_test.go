package push

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPushMessagesMatchAgentV1ContractFixture(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "agent", "v1", "fixtures", "push-messages.json"))
	if err != nil {
		t.Fatalf("read push messages fixture: %v", err)
	}

	var payload []PushMessage
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("unmarshal push messages into Go struct: %v", err)
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal push messages from Go struct: %v", err)
	}

	var original []map[string]any
	var roundTripped []map[string]any
	if err := json.Unmarshal(data, &original); err != nil {
		t.Fatalf("unmarshal original push messages as map: %v", err)
	}
	if err := json.Unmarshal(encoded, &roundTripped); err != nil {
		t.Fatalf("unmarshal round-tripped push messages as map: %v", err)
	}
	if !reflect.DeepEqual(original, roundTripped) {
		t.Fatalf("push messages did not round-trip through Go struct\noriginal: %#v\nround-tripped: %#v", original, roundTripped)
	}

	if len(payload) != 6 {
		t.Fatalf("expected 6 push messages, got %d", len(payload))
	}
	if payload[1].Type != "sample_request" || payload[1].ComponentKeys[0] != "demo" {
		t.Fatalf("sample push mismatch: %#v", payload[1])
	}
	if payload[2].Type != "action" || payload[2].Action != "self_update" {
		t.Fatalf("action push mismatch: %#v", payload[2])
	}
	if payload[4].Type != "tap_start" || payload[4].ComponentID != "demo" {
		t.Fatalf("tap start push mismatch: %#v", payload[4])
	}
}
