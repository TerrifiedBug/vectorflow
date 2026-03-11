// agent/internal/ws/client_test.go
package ws

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestPushMessageParsing(t *testing.T) {
	tests := []struct {
		name     string
		json     string
		wantType string
	}{
		{
			name:     "config_changed",
			json:     `{"type":"config_changed","pipelineId":"p1","reason":"deploy"}`,
			wantType: "config_changed",
		},
		{
			name:     "config_changed_no_pipeline",
			json:     `{"type":"config_changed","reason":"maintenance_on"}`,
			wantType: "config_changed",
		},
		{
			name:     "sample_request",
			json:     `{"type":"sample_request","requestId":"r1","pipelineId":"p1","componentKeys":["source_in"],"limit":5}`,
			wantType: "sample_request",
		},
		{
			name:     "action_self_update",
			json:     `{"type":"action","action":"self_update","targetVersion":"v1.2.3","downloadUrl":"https://example.com/agent","checksum":"sha256:abc"}`,
			wantType: "action",
		},
		{
			name:     "poll_interval",
			json:     `{"type":"poll_interval","intervalMs":5000}`,
			wantType: "poll_interval",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var msg PushMessage
			if err := json.Unmarshal([]byte(tt.json), &msg); err != nil {
				t.Fatalf("unmarshal error: %v", err)
			}
			if msg.Type != tt.wantType {
				t.Errorf("got type %q, want %q", msg.Type, tt.wantType)
			}
		})
	}
}

func TestClientConnectsAndReceivesMessages(t *testing.T) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	var serverConn *websocket.Conn
	var mu sync.Mutex
	connected := make(chan struct{}, 1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify auth header
		auth := r.Header.Get("Authorization")
		if auth != "Bearer test-token" {
			http.Error(w, "unauthorized", 401)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Logf("upgrade error: %v", err)
			return
		}
		mu.Lock()
		serverConn = conn
		mu.Unlock()
		select {
		case connected <- struct{}{}:
		default:
		}
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	var received []PushMessage
	var recvMu sync.Mutex
	msgCh := make(chan struct{}, 1)

	client := New(wsURL, "test-token", func(msg PushMessage) {
		recvMu.Lock()
		received = append(received, msg)
		recvMu.Unlock()
		select {
		case msgCh <- struct{}{}:
		default:
		}
	})

	go client.Connect()
	defer client.Close()

	// Wait for connection (channel-based, not sleep)
	select {
	case <-connected:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for connection")
	}

	// Send a message from server
	mu.Lock()
	conn := serverConn
	mu.Unlock()

	if conn == nil {
		t.Fatal("server did not receive connection")
	}

	msg := PushMessage{Type: "config_changed", PipelineID: "p1", Reason: "deploy"}
	data, _ := json.Marshal(msg)
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		t.Fatalf("write error: %v", err)
	}

	// Wait for message to be received (channel-based)
	select {
	case <-msgCh:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for message")
	}

	recvMu.Lock()
	defer recvMu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 message, got %d", len(received))
	}
	if received[0].Type != "config_changed" {
		t.Errorf("got type %q, want config_changed", received[0].Type)
	}
	if received[0].PipelineID != "p1" {
		t.Errorf("got pipelineId %q, want p1", received[0].PipelineID)
	}
}

func TestClientReconnectsAfterDisconnect(t *testing.T) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	var connections int
	var connMu sync.Mutex
	reconnected := make(chan struct{}, 1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		connMu.Lock()
		connections++
		count := connections
		connMu.Unlock()

		if count == 1 {
			// Close first connection to trigger reconnect
			time.Sleep(100 * time.Millisecond)
			conn.Close()
		} else {
			// Signal reconnect happened
			select {
			case reconnected <- struct{}{}:
			default:
			}
			// Keep second connection open
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					return
				}
			}
		}
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	client := New(wsURL, "", func(msg PushMessage) {})
	go client.Connect()
	defer client.Close()

	// Wait for reconnect (channel-based, not sleep)
	select {
	case <-reconnected:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for reconnect")
	}

	connMu.Lock()
	defer connMu.Unlock()
	if connections < 2 {
		t.Errorf("expected at least 2 connections (reconnect), got %d", connections)
	}
}
