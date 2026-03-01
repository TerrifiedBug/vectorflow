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

// HostMetrics holds system-level metrics scraped from Vector's hostMetrics API.
type HostMetrics struct {
	MemoryTotalBytes  int64   `json:"memoryTotalBytes"`
	MemoryUsedBytes   int64   `json:"memoryUsedBytes"`
	MemoryFreeBytes   int64   `json:"memoryFreeBytes"`
	CpuSecondsTotal   float64 `json:"cpuSecondsTotal"`
	LoadAvg1          float64 `json:"loadAvg1"`
	LoadAvg5          float64 `json:"loadAvg5"`
	LoadAvg15         float64 `json:"loadAvg15"`
	FsTotalBytes      int64   `json:"fsTotalBytes"`
	FsUsedBytes       int64   `json:"fsUsedBytes"`
	FsFreeBytes       int64   `json:"fsFreeBytes"`
	DiskReadBytes     int64   `json:"diskReadBytes"`
	DiskWrittenBytes  int64   `json:"diskWrittenBytes"`
	NetRxBytes        int64   `json:"netRxBytes"`
	NetTxBytes        int64   `json:"netTxBytes"`
}

// ScrapeResult contains both pipeline and host metrics from a single scrape.
type ScrapeResult struct {
	Pipeline PipelineMetrics
	Host     HostMetrics
}

var httpClient = &http.Client{Timeout: 5 * time.Second}

// Scrape queries Vector's GraphQL API and returns aggregated pipeline and host metrics.
// Returns zero metrics on any error (non-fatal).
func Scrape(apiPort int) ScrapeResult {
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
						}
					}
					... on Sink {
						metrics {
							receivedEventsTotal { receivedEventsTotal }
							sentEventsTotal { sentEventsTotal }
							sentBytesTotal { sentBytesTotal }
						}
					}
				}
			}
		}
		hostMetrics {
			memory { totalBytes freeBytes usedBytes }
			cpu { cpuSecondsTotal }
			loadAverage { load1 load5 load15 }
			filesystem { totalBytes freeBytes usedBytes }
			disk { readBytesTotal writtenBytesTotal }
			network { receiveBytesTotal transmitBytesTotal }
		}
	}`

	body, err := json.Marshal(map[string]string{"query": query})
	if err != nil {
		return ScrapeResult{}
	}

	resp, err := httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return ScrapeResult{}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ScrapeResult{}
	}

	var result graphqlResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return ScrapeResult{}
	}

	var sr ScrapeResult

	if result.Data != nil && result.Data.Components != nil {
		for _, edge := range result.Data.Components.Edges {
			node := edge.Node
			if node.Metrics == nil {
				continue
			}

			switch node.TypeName {
			case "Source":
				sr.Pipeline.EventsIn += metricValue(node.Metrics.ReceivedEventsTotal)
				sr.Pipeline.BytesIn += metricValue(node.Metrics.ReceivedBytesTotal)
			case "Transform":
				// No error counters in Vector 0.44.0
			case "Sink":
				sr.Pipeline.EventsOut += metricValue(node.Metrics.SentEventsTotal)
				sr.Pipeline.BytesOut += metricValue(node.Metrics.SentBytesTotal)
			}
		}
	}

	if result.Data != nil && result.Data.HostMetrics != nil {
		hm := result.Data.HostMetrics
		sr.Host = HostMetrics{
			MemoryTotalBytes: int64(hm.Memory.TotalBytes),
			MemoryUsedBytes:  int64(hm.Memory.UsedBytes),
			MemoryFreeBytes:  int64(hm.Memory.FreeBytes),
			CpuSecondsTotal:  hm.CPU.CpuSecondsTotal,
			LoadAvg1:         hm.LoadAverage.Load1,
			LoadAvg5:         hm.LoadAverage.Load5,
			LoadAvg15:        hm.LoadAverage.Load15,
			FsTotalBytes:     int64(hm.Filesystem.TotalBytes),
			FsUsedBytes:      int64(hm.Filesystem.UsedBytes),
			FsFreeBytes:      int64(hm.Filesystem.FreeBytes),
			DiskReadBytes:    int64(hm.Disk.ReadBytesTotal),
			DiskWrittenBytes: int64(hm.Disk.WrittenBytesTotal),
			NetRxBytes:       int64(hm.Network.ReceiveBytesTotal),
			NetTxBytes:       int64(hm.Network.TransmitBytesTotal),
		}
	}

	return sr
}

// GraphQL response types for Vector's component metrics API.

type graphqlResponse struct {
	Data *graphqlData `json:"data"`
}

type graphqlData struct {
	Components  *graphqlComponents  `json:"components"`
	HostMetrics *graphqlHostMetrics `json:"hostMetrics"`
}

type graphqlHostMetrics struct {
	Memory      graphqlMemory      `json:"memory"`
	CPU         graphqlCPU         `json:"cpu"`
	LoadAverage graphqlLoadAverage `json:"loadAverage"`
	Filesystem  graphqlFilesystem  `json:"filesystem"`
	Disk        graphqlDisk        `json:"disk"`
	Network     graphqlNetwork     `json:"network"`
}

type graphqlMemory struct {
	TotalBytes float64 `json:"totalBytes"`
	FreeBytes  float64 `json:"freeBytes"`
	UsedBytes  float64 `json:"usedBytes"`
}

type graphqlCPU struct {
	CpuSecondsTotal float64 `json:"cpuSecondsTotal"`
}

type graphqlLoadAverage struct {
	Load1  float64 `json:"load1"`
	Load5  float64 `json:"load5"`
	Load15 float64 `json:"load15"`
}

type graphqlFilesystem struct {
	TotalBytes float64 `json:"totalBytes"`
	FreeBytes  float64 `json:"freeBytes"`
	UsedBytes  float64 `json:"usedBytes"`
}

type graphqlDisk struct {
	ReadBytesTotal    float64 `json:"readBytesTotal"`
	WrittenBytesTotal float64 `json:"writtenBytesTotal"`
}

type graphqlNetwork struct {
	ReceiveBytesTotal  float64 `json:"receiveBytesTotal"`
	TransmitBytesTotal float64 `json:"transmitBytesTotal"`
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
