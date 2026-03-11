// agent/internal/ws/client.go
package ws

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Client manages a persistent WebSocket connection to the VectorFlow server.
type Client struct {
	url       string
	token     string
	onMessage func(PushMessage)

	mu   sync.Mutex
	conn *websocket.Conn
	done chan struct{}
}

// New creates a WebSocket client. Call Connect() to start.
func New(url, token string, onMessage func(PushMessage)) *Client {
	return &Client{
		url:       url,
		token:     token,
		onMessage: onMessage,
		done:      make(chan struct{}),
	}
}

// Connect establishes the WebSocket connection with exponential backoff retry.
// Blocks until Close() is called. After connecting, starts a read loop that
// calls onMessage for each received message.
func (c *Client) Connect() {
	backoff := time.Second
	maxBackoff := 30 * time.Second

	for {
		select {
		case <-c.done:
			return
		default:
		}

		dialer := websocket.Dialer{
			HandshakeTimeout: 10 * time.Second,
		}
		header := http.Header{}
		if c.token != "" {
			header.Set("Authorization", "Bearer "+c.token)
		}

		conn, _, err := dialer.Dial(c.url, header)
		if err != nil {
			slog.Warn("websocket connect failed, retrying", "url", c.url, "backoff", backoff, "error", err)
			select {
			case <-time.After(backoff):
			case <-c.done:
				return
			}
			backoff = backoff * 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
			continue
		}

		// Connected — reset backoff
		backoff = time.Second
		slog.Info("websocket connected", "url", c.url)

		c.mu.Lock()
		c.conn = conn
		c.mu.Unlock()

		// Set read deadline so silent network drops are detected.
		// Reset on every pong. Ping interval is 30s + 10s timeout = 40s.
		conn.SetReadDeadline(time.Now().Add(45 * time.Second))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(45 * time.Second))
			return nil
		})

		// Read loop — blocks until connection drops
		c.readLoop(conn)

		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()

		slog.Warn("websocket disconnected, reconnecting", "backoff", backoff)
	}
}

func (c *Client) readLoop(conn *websocket.Conn) {
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				slog.Warn("websocket read error", "error", err)
			}
			return
		}

		// Reset read deadline on any received message
		conn.SetReadDeadline(time.Now().Add(45 * time.Second))

		var msg PushMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Warn("websocket message parse error", "error", err, "data", string(data))
			continue
		}

		slog.Debug("websocket message received", "type", msg.Type)
		c.onMessage(msg)
	}
}

// Close gracefully shuts down the WebSocket connection.
func (c *Client) Close() {
	select {
	case <-c.done:
		return // already closed
	default:
		close(c.done)
	}

	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()

	if conn != nil {
		conn.WriteMessage(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		)
		conn.Close()
	}
}
