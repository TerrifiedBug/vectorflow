package metrics

import (
	"bufio"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// PipelineMetrics holds aggregated metrics across all components in a pipeline.
type PipelineMetrics struct {
	EventsIn        int64
	EventsOut       int64
	ErrorsTotal     int64
	EventsDiscarded int64
	BytesIn         int64
	BytesOut        int64
}

// ComponentMetrics holds per-component metrics for editor node overlays.
type ComponentMetrics struct {
	ComponentID     string
	ComponentKind   string // source, transform, sink
	ReceivedEvents  int64
	SentEvents      int64
	ReceivedBytes   int64
	SentBytes       int64
	ErrorsTotal     int64
	DiscardedEvents    int64
	LatencyMeanSeconds float64 // mean event time in component (seconds)
}

// HostMetrics holds system-level metrics from Vector's host_metrics source.
type HostMetrics struct {
	MemoryTotalBytes  int64
	MemoryUsedBytes   int64
	MemoryFreeBytes   int64
	CpuSecondsTotal   float64
	CpuSecondsIdle    float64
	LoadAvg1          float64
	LoadAvg5          float64
	LoadAvg15         float64
	FsTotalBytes      int64
	FsUsedBytes       int64
	FsFreeBytes       int64
	DiskReadBytes     int64
	DiskWrittenBytes  int64
	NetRxBytes        int64
	NetTxBytes        int64
}

// ScrapeResult contains all metrics from a single Prometheus scrape.
type ScrapeResult struct {
	Pipeline   PipelineMetrics
	Components []ComponentMetrics
	Host       HostMetrics
}

var httpClient = &http.Client{Timeout: 5 * time.Second}

// ScrapePrometheus fetches and parses Vector's Prometheus metrics endpoint.
// Returns zero metrics on any error (non-fatal).
func ScrapePrometheus(metricsPort int) ScrapeResult {
	url := fmt.Sprintf("http://127.0.0.1:%d/metrics", metricsPort)

	resp, err := httpClient.Get(url)
	if err != nil {
		return ScrapeResult{}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ScrapeResult{}
	}

	var sr ScrapeResult
	componentMap := make(map[string]*ComponentMetrics)

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 || line[0] == '#' {
			continue
		}

		name, labels, value := parsePrometheusLine(line)
		if name == "" {
			continue
		}

		componentID := labels["component_id"]
		componentKind := labels["component_kind"]
		isInternal := strings.HasPrefix(componentID, "vf_")

		// Per-component pipeline metrics (exclude injected vf_ components from pipeline totals)
		switch name {
		case "vector_component_received_events_total", "component_received_events_total":
			v := int64(value)
			if componentKind == "source" && !isInternal {
				sr.Pipeline.EventsIn += v
			}
			getOrCreate(componentMap, componentID, componentKind).ReceivedEvents = v

		case "vector_component_sent_events_total", "component_sent_events_total":
			v := int64(value)
			if componentKind == "sink" && !isInternal {
				sr.Pipeline.EventsOut += v
			}
			getOrCreate(componentMap, componentID, componentKind).SentEvents = v

		case "vector_component_received_bytes_total", "component_received_bytes_total":
			v := int64(value)
			if componentKind == "source" && !isInternal {
				sr.Pipeline.BytesIn += v
			}
			getOrCreate(componentMap, componentID, componentKind).ReceivedBytes = v

		case "vector_component_sent_bytes_total", "component_sent_bytes_total":
			v := int64(value)
			if componentKind == "sink" && !isInternal {
				sr.Pipeline.BytesOut += v
			}
			getOrCreate(componentMap, componentID, componentKind).SentBytes = v

		case "vector_component_errors_total", "component_errors_total":
			v := int64(value)
			if !isInternal {
				sr.Pipeline.ErrorsTotal += v
			}
			getOrCreate(componentMap, componentID, componentKind).ErrorsTotal += v

		case "vector_component_discarded_events_total", "component_discarded_events_total":
			v := int64(value)
			if !isInternal {
				sr.Pipeline.EventsDiscarded += v
			}
			getOrCreate(componentMap, componentID, componentKind).DiscardedEvents += v

		case "vector_component_latency_mean_seconds", "component_latency_mean_seconds":
			if !isInternal {
				getOrCreate(componentMap, componentID, componentKind).LatencyMeanSeconds = value
			}

		// Host metrics – use += to aggregate across CPU cores, devices, interfaces, etc.
		case "host_memory_total_bytes":
			sr.Host.MemoryTotalBytes += int64(value)
		case "host_memory_used_bytes":
			sr.Host.MemoryUsedBytes += int64(value)
		case "host_memory_free_bytes":
			sr.Host.MemoryFreeBytes += int64(value)
		case "host_cpu_seconds_total":
			sr.Host.CpuSecondsTotal += value
			mode := labels["mode"]
			if mode == "idle" || mode == "iowait" {
				sr.Host.CpuSecondsIdle += value
			}
		case "host_load1":
			sr.Host.LoadAvg1 += value
		case "host_load5":
			sr.Host.LoadAvg5 += value
		case "host_load15":
			sr.Host.LoadAvg15 += value
		case "host_filesystem_total_bytes":
			sr.Host.FsTotalBytes += int64(value)
		case "host_filesystem_used_bytes":
			sr.Host.FsUsedBytes += int64(value)
		case "host_filesystem_free_bytes":
			sr.Host.FsFreeBytes += int64(value)
		case "host_disk_read_bytes_total":
			sr.Host.DiskReadBytes += int64(value)
		case "host_disk_written_bytes_total":
			sr.Host.DiskWrittenBytes += int64(value)
		case "host_network_receive_bytes_total":
			sr.Host.NetRxBytes += int64(value)
		case "host_network_transmit_bytes_total":
			sr.Host.NetTxBytes += int64(value)
		}
	}

	if err := scanner.Err(); err != nil {
		return ScrapeResult{}
	}

	// Convert component map to slice, filtering out injected vf_ components
	for _, cm := range componentMap {
		if strings.HasPrefix(cm.ComponentID, "vf_") {
			continue
		}
		sr.Components = append(sr.Components, *cm)
	}

	return sr
}

// getOrCreate returns the ComponentMetrics for a given componentID, creating it if needed.
func getOrCreate(m map[string]*ComponentMetrics, id, kind string) *ComponentMetrics {
	if id == "" {
		// Return a throwaway struct if there's no component_id label
		return &ComponentMetrics{}
	}
	if cm, ok := m[id]; ok {
		return cm
	}
	cm := &ComponentMetrics{ComponentID: id, ComponentKind: kind}
	m[id] = cm
	return cm
}

// parsePrometheusLine parses a single Prometheus exposition line into name, labels, value.
// Example: `component_errors_total{component_id="my_source",component_kind="source"} 42`
func parsePrometheusLine(line string) (string, map[string]string, float64) {
	labels := make(map[string]string)

	// Split value (and optional timestamp) from the metric name + labels
	// Format: name{labels} value [timestamp]
	spaceIdx := strings.LastIndex(line, " ")
	if spaceIdx < 0 {
		return "", nil, 0
	}
	valueStr := line[spaceIdx+1:]
	prefix := line[:spaceIdx]

	value, err := strconv.ParseFloat(valueStr, 64)
	if err != nil {
		return "", nil, 0
	}

	// Check if what we parsed is actually a timestamp (the real value is before it)
	// Timestamps are Unix milliseconds (13+ digits), values are typically much smaller
	// More robust: check if there's another space indicating metric value timestamp format
	if innerSpace := strings.LastIndex(prefix, " "); innerSpace >= 0 {
		if innerVal, innerErr := strconv.ParseFloat(prefix[innerSpace+1:], 64); innerErr == nil {
			// This is the actual metric value; what we first parsed was the timestamp
			value = innerVal
			prefix = prefix[:innerSpace]
		}
	}

	// Split name from labels
	braceIdx := strings.IndexByte(prefix, '{')
	if braceIdx < 0 {
		return prefix, labels, value
	}

	name := prefix[:braceIdx]
	labelStr := prefix[braceIdx+1:]
	if len(labelStr) > 0 && labelStr[len(labelStr)-1] == '}' {
		labelStr = labelStr[:len(labelStr)-1]
	}

	// Parse labels: key="value",key2="value2"
	for _, pair := range splitLabels(labelStr) {
		eqIdx := strings.IndexByte(pair, '=')
		if eqIdx < 0 {
			continue
		}
		k := pair[:eqIdx]
		v := pair[eqIdx+1:]
		if len(v) >= 2 && v[0] == '"' && v[len(v)-1] == '"' {
			v = v[1 : len(v)-1]
		}
		labels[k] = v
	}

	return name, labels, value
}

// splitLabels splits comma-separated label pairs, respecting quoted values.
func splitLabels(s string) []string {
	var parts []string
	var current strings.Builder
	inQuote := false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch == '"' {
			inQuote = !inQuote
			current.WriteByte(ch)
		} else if ch == ',' && !inQuote {
			parts = append(parts, current.String())
			current.Reset()
		} else {
			current.WriteByte(ch)
		}
	}
	if current.Len() > 0 {
		parts = append(parts, current.String())
	}
	return parts
}
