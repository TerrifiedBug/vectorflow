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
