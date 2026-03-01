package metrics

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// PipelineMetrics holds aggregated metrics scraped from a Vector instance.
type PipelineMetrics struct {
	EventsIn    int64
	EventsOut   int64
	ErrorsTotal int64
	BytesIn     int64
	BytesOut    int64
}

var httpClient = &http.Client{Timeout: 5 * time.Second}

// Scrape queries Vector's GraphQL API and returns aggregated pipeline metrics.
// Returns zero metrics on any error (non-fatal).
func Scrape(apiPort int) PipelineMetrics {
	url := fmt.Sprintf("http://127.0.0.1:%d/graphql", apiPort)

	query := `{
		components(first: 1000) {
			edges {
				node {
					__typename
					... on Source {
						metrics {
							receivedEventsTotal { receivedEventsTotal }
							sentEventsTotal { sentEventsTotal }
							receivedBytesTotal { receivedBytesTotal }
						}
					}
					... on Transform {
						metrics {
							receivedEventsTotal { receivedEventsTotal }
							sentEventsTotal { sentEventsTotal }
							errorsTotal: componentErrorsTotal { componentErrorsTotal }
						}
					}
					... on Sink {
						metrics {
							receivedEventsTotal { receivedEventsTotal }
							sentEventsTotal { sentEventsTotal }
							sentBytesTotal { sentBytesTotal }
							errorsTotal: componentErrorsTotal { componentErrorsTotal }
						}
					}
				}
			}
		}
	}`

	body, err := json.Marshal(map[string]string{"query": query})
	if err != nil {
		return PipelineMetrics{}
	}

	resp, err := httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return PipelineMetrics{}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return PipelineMetrics{}
	}

	var result graphqlResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return PipelineMetrics{}
	}

	var m PipelineMetrics
	if result.Data == nil || result.Data.Components == nil {
		return m
	}

	for _, edge := range result.Data.Components.Edges {
		node := edge.Node
		if node.Metrics == nil {
			continue
		}

		switch node.TypeName {
		case "Source":
			m.EventsIn += metricValue(node.Metrics.ReceivedEventsTotal)
			m.BytesIn += metricValue(node.Metrics.ReceivedBytesTotal)
		case "Transform":
			m.ErrorsTotal += metricValue(node.Metrics.ErrorsTotal)
		case "Sink":
			m.EventsOut += metricValue(node.Metrics.SentEventsTotal)
			m.BytesOut += metricValue(node.Metrics.SentBytesTotal)
			m.ErrorsTotal += metricValue(node.Metrics.ErrorsTotal)
		}
	}

	return m
}

// GraphQL response types for Vector's component metrics API.

type graphqlResponse struct {
	Data *graphqlData `json:"data"`
}

type graphqlData struct {
	Components *graphqlComponents `json:"components"`
}

type graphqlComponents struct {
	Edges []graphqlEdge `json:"edges"`
}

type graphqlEdge struct {
	Node graphqlNode `json:"node"`
}

type graphqlNode struct {
	TypeName string           `json:"__typename"`
	Metrics  *graphqlMetrics  `json:"metrics"`
}

type graphqlMetrics struct {
	ReceivedEventsTotal json.RawMessage `json:"receivedEventsTotal"`
	SentEventsTotal     json.RawMessage `json:"sentEventsTotal"`
	ReceivedBytesTotal  json.RawMessage `json:"receivedBytesTotal"`
	SentBytesTotal      json.RawMessage `json:"sentBytesTotal"`
	ErrorsTotal         json.RawMessage `json:"errorsTotal"`
}

// metricValue extracts the numeric value from Vector's nested metric format:
// { "receivedEventsTotal": { "receivedEventsTotal": 42 } }
// The inner object always has one key whose value is the counter.
func metricValue(raw json.RawMessage) int64 {
	if len(raw) == 0 || string(raw) == "null" {
		return 0
	}
	var obj map[string]float64
	if err := json.Unmarshal(raw, &obj); err != nil {
		return 0
	}
	for _, v := range obj {
		return int64(v)
	}
	return 0
}
