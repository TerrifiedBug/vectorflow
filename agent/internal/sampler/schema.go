package sampler

import (
	"fmt"
	"sort"
)

const maxSampleLen = 64

// FieldInfo describes a single field discovered in a sampled event.
type FieldInfo struct {
	Path   string `json:"path"`   // e.g. ".message", ".kubernetes.pod.name"
	Type   string `json:"type"`   // "string", "float", "boolean", "object", "array", "null"
	Sample string `json:"sample"` // truncated to 64 chars
}

// ExtractSchema walks a JSON object recursively, extracting field paths, types,
// and sample values. Keys are visited in sorted order for deterministic output.
// maxDepth limits how deep into nested objects we recurse (1 = top-level only).
func ExtractSchema(event map[string]interface{}, maxDepth int) []FieldInfo {
	var fields []FieldInfo
	extractFields(event, "", 1, maxDepth, &fields)
	return fields
}

func extractFields(obj map[string]interface{}, prefix string, depth, maxDepth int, fields *[]FieldInfo) {
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		v := obj[k]
		path := prefix + "." + k
		fi := FieldInfo{
			Path:   path,
			Type:   inferType(v),
			Sample: sampleValue(v),
		}
		*fields = append(*fields, fi)

		// Recurse into nested objects if within depth limit.
		if nested, ok := v.(map[string]interface{}); ok && depth < maxDepth {
			extractFields(nested, path, depth+1, maxDepth, fields)
		}
	}
}

func inferType(v interface{}) string {
	switch v.(type) {
	case string:
		return "string"
	case float64:
		return "float"
	case bool:
		return "boolean"
	case []interface{}:
		return "array"
	case map[string]interface{}:
		return "object"
	case nil:
		return "null"
	default:
		return "unknown"
	}
}

func sampleValue(v interface{}) string {
	switch val := v.(type) {
	case map[string]interface{}:
		return ""
	case []interface{}:
		return fmt.Sprintf("[%d items]", len(val))
	case nil:
		return "null"
	case string:
		return truncate(val)
	case float64:
		return truncate(fmt.Sprintf("%v", val))
	case bool:
		return fmt.Sprintf("%v", val)
	default:
		return truncate(fmt.Sprintf("%v", val))
	}
}

func truncate(s string) string {
	if len(s) > maxSampleLen {
		return s[:maxSampleLen] + "..."
	}
	return s
}

// MergeSchemas produces a union of fields by path. When the same path appears
// in multiple schemas the first sample value wins.
func MergeSchemas(schemas [][]FieldInfo) []FieldInfo {
	seen := make(map[string]struct{})
	var merged []FieldInfo

	for _, schema := range schemas {
		for _, fi := range schema {
			if _, exists := seen[fi.Path]; !exists {
				seen[fi.Path] = struct{}{}
				merged = append(merged, fi)
			}
		}
	}
	return merged
}
