package sampler

import (
	"strings"
	"testing"
)

func TestExtractSchema_FlatObject(t *testing.T) {
	event := map[string]interface{}{
		"message":   "hello world",
		"status":    float64(200),
		"is_active": true,
	}

	fields := ExtractSchema(event, 10)

	if len(fields) != 3 {
		t.Fatalf("expected 3 fields, got %d", len(fields))
	}

	// Fields should be sorted by key name.
	expected := []struct {
		path   string
		typ    string
		sample string
	}{
		{".is_active", "boolean", "true"},
		{".message", "string", "hello world"},
		{".status", "float", "200"},
	}

	for i, e := range expected {
		if fields[i].Path != e.path {
			t.Errorf("field %d: expected path %q, got %q", i, e.path, fields[i].Path)
		}
		if fields[i].Type != e.typ {
			t.Errorf("field %d: expected type %q, got %q", i, e.typ, fields[i].Type)
		}
		if fields[i].Sample != e.sample {
			t.Errorf("field %d: expected sample %q, got %q", i, e.sample, fields[i].Sample)
		}
	}
}

func TestExtractSchema_NestedObject(t *testing.T) {
	event := map[string]interface{}{
		"kubernetes": map[string]interface{}{
			"pod": map[string]interface{}{
				"name": "my-pod",
			},
			"namespace": "default",
		},
		"message": "log line",
	}

	fields := ExtractSchema(event, 10)

	paths := make(map[string]FieldInfo)
	for _, f := range fields {
		paths[f.Path] = f
	}

	// Check that nested paths are correct.
	if f, ok := paths[".kubernetes"]; !ok {
		t.Error("missing .kubernetes field")
	} else if f.Type != "object" {
		t.Errorf("expected .kubernetes type 'object', got %q", f.Type)
	} else if f.Sample != "" {
		t.Errorf("expected empty sample for object, got %q", f.Sample)
	}

	if f, ok := paths[".kubernetes.pod"]; !ok {
		t.Error("missing .kubernetes.pod field")
	} else if f.Type != "object" {
		t.Errorf("expected .kubernetes.pod type 'object', got %q", f.Type)
	}

	if f, ok := paths[".kubernetes.pod.name"]; !ok {
		t.Error("missing .kubernetes.pod.name field")
	} else if f.Type != "string" {
		t.Errorf("expected type 'string', got %q", f.Type)
	} else if f.Sample != "my-pod" {
		t.Errorf("expected sample 'my-pod', got %q", f.Sample)
	}

	if f, ok := paths[".kubernetes.namespace"]; !ok {
		t.Error("missing .kubernetes.namespace field")
	} else if f.Sample != "default" {
		t.Errorf("expected sample 'default', got %q", f.Sample)
	}

	if f, ok := paths[".message"]; !ok {
		t.Error("missing .message field")
	} else if f.Sample != "log line" {
		t.Errorf("expected sample 'log line', got %q", f.Sample)
	}
}

func TestExtractSchema_DepthLimit(t *testing.T) {
	event := map[string]interface{}{
		"level1": map[string]interface{}{
			"level2": map[string]interface{}{
				"level3": "deep",
			},
		},
	}

	// maxDepth=2 means top-level (depth 1) + one nested (depth 2).
	fields := ExtractSchema(event, 2)

	paths := make(map[string]bool)
	for _, f := range fields {
		paths[f.Path] = true
	}

	if !paths[".level1"] {
		t.Error("missing .level1")
	}
	if !paths[".level1.level2"] {
		t.Error("missing .level1.level2")
	}
	// level3 should NOT appear because we hit maxDepth.
	if paths[".level1.level2.level3"] {
		t.Error(".level1.level2.level3 should not appear with maxDepth=2")
	}
}

func TestExtractSchema_DepthLimitOne(t *testing.T) {
	event := map[string]interface{}{
		"top": map[string]interface{}{
			"nested": "value",
		},
	}

	// maxDepth=1 means only top-level fields.
	fields := ExtractSchema(event, 1)

	if len(fields) != 1 {
		t.Fatalf("expected 1 field with maxDepth=1, got %d", len(fields))
	}
	if fields[0].Path != ".top" {
		t.Errorf("expected path '.top', got %q", fields[0].Path)
	}
	if fields[0].Type != "object" {
		t.Errorf("expected type 'object', got %q", fields[0].Type)
	}
}

func TestExtractSchema_SampleTruncation(t *testing.T) {
	longValue := strings.Repeat("a", 100)
	event := map[string]interface{}{
		"long_field": longValue,
	}

	fields := ExtractSchema(event, 10)

	if len(fields) != 1 {
		t.Fatalf("expected 1 field, got %d", len(fields))
	}

	if len(fields[0].Sample) != 67 { // 64 + len("...")
		t.Errorf("expected truncated sample length 67, got %d", len(fields[0].Sample))
	}
	if !strings.HasSuffix(fields[0].Sample, "...") {
		t.Error("expected truncated sample to end with '...'")
	}
	if fields[0].Sample[:64] != strings.Repeat("a", 64) {
		t.Error("expected first 64 chars to be preserved")
	}
}

func TestExtractSchema_NoTruncationAtExactLimit(t *testing.T) {
	exactValue := strings.Repeat("b", 64)
	event := map[string]interface{}{
		"exact": exactValue,
	}

	fields := ExtractSchema(event, 10)

	if fields[0].Sample != exactValue {
		t.Errorf("value at exact limit should not be truncated")
	}
}

func TestExtractSchema_ArrayType(t *testing.T) {
	event := map[string]interface{}{
		"tags": []interface{}{"a", "b", "c"},
	}

	fields := ExtractSchema(event, 10)

	if len(fields) != 1 {
		t.Fatalf("expected 1 field, got %d", len(fields))
	}
	if fields[0].Type != "array" {
		t.Errorf("expected type 'array', got %q", fields[0].Type)
	}
	if fields[0].Sample != "[3 items]" {
		t.Errorf("expected sample '[3 items]', got %q", fields[0].Sample)
	}
}

func TestExtractSchema_EmptyArray(t *testing.T) {
	event := map[string]interface{}{
		"empty": []interface{}{},
	}

	fields := ExtractSchema(event, 10)

	if fields[0].Sample != "[0 items]" {
		t.Errorf("expected '[0 items]', got %q", fields[0].Sample)
	}
}

func TestExtractSchema_NullValue(t *testing.T) {
	event := map[string]interface{}{
		"nothing": nil,
	}

	fields := ExtractSchema(event, 10)

	if fields[0].Type != "null" {
		t.Errorf("expected type 'null', got %q", fields[0].Type)
	}
	if fields[0].Sample != "null" {
		t.Errorf("expected sample 'null', got %q", fields[0].Sample)
	}
}

func TestExtractSchema_BooleanType(t *testing.T) {
	event := map[string]interface{}{
		"enabled": true,
		"paused":  false,
	}

	fields := ExtractSchema(event, 10)

	paths := make(map[string]FieldInfo)
	for _, f := range fields {
		paths[f.Path] = f
	}

	if f := paths[".enabled"]; f.Type != "boolean" || f.Sample != "true" {
		t.Errorf("expected boolean/true, got %s/%s", f.Type, f.Sample)
	}
	if f := paths[".paused"]; f.Type != "boolean" || f.Sample != "false" {
		t.Errorf("expected boolean/false, got %s/%s", f.Type, f.Sample)
	}
}

func TestMergeSchemas_Union(t *testing.T) {
	schema1 := []FieldInfo{
		{Path: ".message", Type: "string", Sample: "first"},
		{Path: ".host", Type: "string", Sample: "server1"},
	}
	schema2 := []FieldInfo{
		{Path: ".message", Type: "string", Sample: "second"},
		{Path: ".status", Type: "float", Sample: "200"},
	}

	merged := MergeSchemas([][]FieldInfo{schema1, schema2})

	if len(merged) != 3 {
		t.Fatalf("expected 3 merged fields, got %d", len(merged))
	}

	paths := make(map[string]FieldInfo)
	for _, f := range merged {
		paths[f.Path] = f
	}

	// First sample wins for .message.
	if paths[".message"].Sample != "first" {
		t.Errorf("expected first sample to win, got %q", paths[".message"].Sample)
	}

	if _, ok := paths[".host"]; !ok {
		t.Error("missing .host in merged schema")
	}
	if _, ok := paths[".status"]; !ok {
		t.Error("missing .status in merged schema")
	}
}

func TestMergeSchemas_Empty(t *testing.T) {
	merged := MergeSchemas(nil)
	if merged != nil {
		t.Errorf("expected nil for empty merge, got %v", merged)
	}

	merged = MergeSchemas([][]FieldInfo{})
	if merged != nil {
		t.Errorf("expected nil for empty slice merge, got %v", merged)
	}
}

func TestMergeSchemas_Single(t *testing.T) {
	schema := []FieldInfo{
		{Path: ".a", Type: "string", Sample: "val"},
	}

	merged := MergeSchemas([][]FieldInfo{schema})
	if len(merged) != 1 {
		t.Fatalf("expected 1 field, got %d", len(merged))
	}
	if merged[0].Path != ".a" {
		t.Errorf("expected path '.a', got %q", merged[0].Path)
	}
}

func TestExtractSchema_EmptyObject(t *testing.T) {
	event := map[string]interface{}{}
	fields := ExtractSchema(event, 10)
	if len(fields) != 0 {
		t.Errorf("expected 0 fields for empty object, got %d", len(fields))
	}
}

func TestExtractSchema_SortedOrder(t *testing.T) {
	event := map[string]interface{}{
		"zebra":    "z",
		"apple":    "a",
		"mango":    "m",
		"banana":   "b",
	}

	fields := ExtractSchema(event, 10)

	expectedOrder := []string{".apple", ".banana", ".mango", ".zebra"}
	for i, e := range expectedOrder {
		if fields[i].Path != e {
			t.Errorf("position %d: expected %q, got %q", i, e, fields[i].Path)
		}
	}
}
