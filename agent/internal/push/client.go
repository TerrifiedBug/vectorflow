package push

import (
	"bufio"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	maxBackoff    = 30 * time.Second
	readTimeout   = 45 * time.Second
	maxBufferSize = 256 * 1024 // 256KB for large payloads
)

// Client maintains a persistent SSE connection to the server push endpoint.
type Client struct {
	url       string
	token     string
	onMessage func(PushMessage)

	mu     sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}
}

// New creates a new SSE push client.
func New(url, token string, onMessage func(PushMessage)) *Client {
	return &Client{
		url:       url,
		token:     token,
		onMessage: onMessage,
		done:      make(chan struct{}),
	}
}

// Connect blocks and maintains a persistent SSE connection with exponential
// backoff reconnection. Call Close() to stop.
func (c *Client) Connect() {
	ctx, cancel := context.WithCancel(context.Background())
	c.mu.Lock()
	c.cancel = cancel
	c.mu.Unlock()

	backoff := time.Second

	for {
		err := c.stream(ctx)
		if ctx.Err() != nil {
			// Graceful shutdown
			close(c.done)
			return
		}
		slog.Warn("push: connection lost, reconnecting",
			"error", err, "backoff", backoff)
		select {
		case <-ctx.Done():
			close(c.done)
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, maxBackoff)
	}
}

// stream opens a single SSE connection and reads messages until error or cancel.
func (c *Client) stream(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", c.url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &httpError{StatusCode: resp.StatusCode}
	}

	slog.Info("push: connected", "url", c.url)

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, maxBufferSize), maxBufferSize)

	var eventType string
	var dataBuilder strings.Builder

	for scanner.Scan() {
		line := scanner.Text()

		if line == "" {
			// Empty line = dispatch event
			if dataBuilder.Len() > 0 {
				c.dispatch(eventType, dataBuilder.String())
				eventType = ""
				dataBuilder.Reset()
			}
			continue
		}

		if strings.HasPrefix(line, ":") {
			// SSE comment (keepalive) — ignore
			continue
		}

		if strings.HasPrefix(line, "event: ") {
			eventType = strings.TrimPrefix(line, "event: ")
			continue
		}

		if strings.HasPrefix(line, "data: ") {
			if dataBuilder.Len() > 0 {
				dataBuilder.WriteByte('\n')
			}
			dataBuilder.WriteString(strings.TrimPrefix(line, "data: "))
			continue
		}
	}

	if err := scanner.Err(); err != nil {
		return err
	}
	return nil
}

func (c *Client) dispatch(eventType, data string) {
	var msg PushMessage
	if err := json.Unmarshal([]byte(data), &msg); err != nil {
		slog.Error("push: failed to parse message", "error", err, "event", eventType, "data", data)
		return
	}
	c.onMessage(msg)
}

// Close gracefully stops the SSE connection.
func (c *Client) Close() {
	c.mu.Lock()
	cancel := c.cancel
	c.mu.Unlock()

	if cancel != nil {
		cancel()
		<-c.done
	}
}

type httpError struct {
	StatusCode int
}

func (e *httpError) Error() string {
	return "push: unexpected status " + http.StatusText(e.StatusCode)
}
