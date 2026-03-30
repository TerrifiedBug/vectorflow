package push

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestPushMessageParsing(t *testing.T) {
	tests := []struct {
		name     string
		json     string
		wantType string
	}{
		{"config_changed", `{"type":"config_changed","pipelineId":"p1","reason":"deploy"}`, "config_changed"},
		{"sample_request", `{"type":"sample_request","requestId":"r1","pipelineId":"p1","componentKeys":["k1"],"limit":10}`, "sample_request"},
		{"action", `{"type":"action","action":"self_update","targetVersion":"1.0.0"}`, "action"},
		{"poll_interval", `{"type":"poll_interval","intervalMs":5000}`, "poll_interval"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var received PushMessage
			var wg sync.WaitGroup
			wg.Add(1)

			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				w.Header().Set("Cache-Control", "no-cache")
				w.WriteHeader(200)

				flusher, ok := w.(http.Flusher)
				if !ok {
					t.Fatal("expected flusher")
				}

				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", tt.wantType, tt.json)
				flusher.Flush()

				// Keep alive briefly for client to read
				time.Sleep(100 * time.Millisecond)
			}))
			defer server.Close()

			client := New(server.URL, "", "test-token", func(msg PushMessage) {
				received = msg
				wg.Done()
			})

			go client.Connect()
			wg.Wait()
			client.Close()

			if received.Type != tt.wantType {
				t.Errorf("got type %q, want %q", received.Type, tt.wantType)
			}
		})
	}
}

func TestClientSendsAuthHeader(t *testing.T) {
	var gotAuth string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		fmt.Fprintf(w, ": connected\n\n")
		time.Sleep(100 * time.Millisecond)
	}))
	defer server.Close()

	client := New(server.URL, "", "my-secret-token", func(msg PushMessage) {})
	go client.Connect()
	time.Sleep(200 * time.Millisecond)
	client.Close()

	if gotAuth != "Bearer my-secret-token" {
		t.Errorf("got auth %q, want %q", gotAuth, "Bearer my-secret-token")
	}
}

func TestClientReconnectsAfterDisconnect(t *testing.T) {
	var mu sync.Mutex
	connectCount := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		connectCount++
		count := connectCount
		mu.Unlock()

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)

		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("expected flusher")
		}

		fmt.Fprintf(w, ": connected\n\n")
		flusher.Flush()

		if count == 1 {
			// First connection: close immediately to trigger reconnect
			return
		}

		// Second connection: stay open
		time.Sleep(2 * time.Second)
	}))
	defer server.Close()

	client := New(server.URL, "", "test-token", func(msg PushMessage) {})
	go client.Connect()

	// Wait for reconnect
	time.Sleep(3 * time.Second)
	client.Close()

	mu.Lock()
	defer mu.Unlock()
	if connectCount < 2 {
		t.Errorf("expected at least 2 connections (reconnect), got %d", connectCount)
	}
}

func TestClientHandlesKeepalive(t *testing.T) {
	var received PushMessage
	var wg sync.WaitGroup
	wg.Add(1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)

		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("expected flusher")
		}

		// Send keepalive comments before actual data
		fmt.Fprintf(w, ": keepalive\n\n")
		flusher.Flush()
		fmt.Fprintf(w, ": keepalive\n\n")
		flusher.Flush()

		// Then send real message
		fmt.Fprintf(w, "event: config_changed\ndata: {\"type\":\"config_changed\",\"reason\":\"test\"}\n\n")
		flusher.Flush()

		time.Sleep(100 * time.Millisecond)
	}))
	defer server.Close()

	client := New(server.URL, "", "test-token", func(msg PushMessage) {
		received = msg
		wg.Done()
	})
	go client.Connect()
	wg.Wait()
	client.Close()

	if received.Type != "config_changed" {
		t.Errorf("got type %q, want %q", received.Type, "config_changed")
	}
	if received.Reason != "test" {
		t.Errorf("got reason %q, want %q", received.Reason, "test")
	}
}

func TestClientSwitchesToFallbackURL(t *testing.T) {
	var mu sync.Mutex
	fallbackHits := 0

	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer primary.Close()

	fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		fallbackHits++
		mu.Unlock()

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("expected flusher")
		}
		fmt.Fprintf(w, ": connected\n\n")
		flusher.Flush()
		time.Sleep(2 * time.Second)
	}))
	defer fallback.Close()

	client := New(primary.URL, fallback.URL, "test-token", func(msg PushMessage) {})
	go client.Connect()

	time.Sleep(8 * time.Second)
	client.Close()

	mu.Lock()
	defer mu.Unlock()
	if fallbackHits < 1 {
		t.Errorf("expected fallback to be hit at least once, got %d", fallbackHits)
	}
}
