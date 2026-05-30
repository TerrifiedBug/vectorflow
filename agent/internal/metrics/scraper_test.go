package metrics

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func scrapeFixture(t *testing.T, body string) ScrapeResult {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)

	portText := server.URL[strings.LastIndex(server.URL, ":")+1:]
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatalf("parse test server port: %v", err)
	}

	return ScrapePrometheus(port)
}

func TestScrapePrometheusUsesSourceSentTotalsWhenReceivedTotalsAreAbsent(t *testing.T) {
	result := scrapeFixture(t, `
vector_component_sent_events_total{component_id="docker_logs",component_kind="source"} 75
vector_component_sent_bytes_total{component_id="docker_logs",component_kind="source"} 4096
vector_component_received_events_total{component_id="remap",component_kind="transform"} 75
vector_component_sent_events_total{component_id="remap",component_kind="transform"} 75
vector_component_received_events_total{component_id="blackhole",component_kind="sink"} 75
vector_component_sent_events_total{component_id="blackhole",component_kind="sink"} 75
`)

	if result.Pipeline.EventsIn != 75 {
		t.Fatalf("expected pipeline events in from source sent total, got %d", result.Pipeline.EventsIn)
	}
	if result.Pipeline.BytesIn != 4096 {
		t.Fatalf("expected pipeline bytes in from source sent total, got %d", result.Pipeline.BytesIn)
	}
}

func TestScrapePrometheusPrefersSourceReceivedTotalsWhenPresent(t *testing.T) {
	result := scrapeFixture(t, `
vector_component_received_events_total{component_id="http",component_kind="source"} 30
vector_component_sent_events_total{component_id="http",component_kind="source"} 25
vector_component_received_bytes_total{component_id="http",component_kind="source"} 3000
vector_component_sent_bytes_total{component_id="http",component_kind="source"} 2500
`)

	if result.Pipeline.EventsIn != 30 {
		t.Fatalf("expected pipeline events in to prefer source received total, got %d", result.Pipeline.EventsIn)
	}
	if result.Pipeline.BytesIn != 3000 {
		t.Fatalf("expected pipeline bytes in to prefer source received total, got %d", result.Pipeline.BytesIn)
	}
}

func TestScrapePrometheusAggregatesBufferGaugesAndDetectsBackpressure(t *testing.T) {
	result := scrapeFixture(t, `
vector_buffer_size_events{component_id="http_sink",component_kind="sink"} 450
vector_buffer_max_size_events{component_id="http_sink",component_kind="sink"} 500
vector_buffer_size_bytes{component_id="http_sink",component_kind="sink"} 4096
vector_buffer_discarded_events_total{component_id="http_sink",component_kind="sink"} 7
`)

	if result.Pipeline.BufferEvents != 450 {
		t.Fatalf("expected pipeline buffer events 450, got %d", result.Pipeline.BufferEvents)
	}
	if result.Pipeline.BufferMaxEvents != 500 {
		t.Fatalf("expected pipeline buffer max events 500, got %d", result.Pipeline.BufferMaxEvents)
	}
	if result.Pipeline.BufferByteSize != 4096 {
		t.Fatalf("expected pipeline buffer byte size 4096, got %d", result.Pipeline.BufferByteSize)
	}
	if result.Pipeline.BufferDiscardedEvents != 7 {
		t.Fatalf("expected pipeline buffer discarded 7, got %d", result.Pipeline.BufferDiscardedEvents)
	}

	if result.Backpressure.Name != "backpressure" {
		t.Fatalf("expected backpressure metric name, got %q", result.Backpressure.Name)
	}
	if !result.Backpressure.Triggered {
		t.Fatalf("expected backpressure triggered at 450/500 utilization, value=%v", result.Backpressure.Value)
	}
	if result.Backpressure.Value < 0.9 {
		t.Fatalf("expected backpressure utilization ~0.9, got %v", result.Backpressure.Value)
	}
	if len(result.Backpressure.Components) != 1 || result.Backpressure.Components[0] != "http_sink" {
		t.Fatalf("expected http_sink in backpressure components, got %v", result.Backpressure.Components)
	}
}

func TestScrapePrometheusBackpressureNotTriggeredBelowThreshold(t *testing.T) {
	result := scrapeFixture(t, `
vector_buffer_size_bytes{component_id="s3",component_kind="sink"} 1000
vector_buffer_max_size_bytes{component_id="s3",component_kind="sink"} 10000
`)

	if result.Backpressure.Triggered {
		t.Fatalf("expected no backpressure at 10%% utilization, value=%v", result.Backpressure.Value)
	}
	if result.Backpressure.Value != 0.1 {
		t.Fatalf("expected utilization 0.1, got %v", result.Backpressure.Value)
	}
	if len(result.Backpressure.Components) != 0 {
		t.Fatalf("expected no triggered components, got %v", result.Backpressure.Components)
	}
}
