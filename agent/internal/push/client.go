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
	maxBufferSize = 256 * 1024 // 256KB for large payloads
)

// sseHTTPClient sets a response-header timeout so a stalled proxy doesn't block
// the connect goroutine indefinitely. Body reads remain context-driven.
var sseHTTPClient = &http.Client{
	Transport: &http.Transport{
		ResponseHeaderTimeout: 15 * time.Second,
	},
}

// Client maintains a persistent SSE connection to the server push endpoint.
type Client struct {
	url         string
	fallbackURL string
	token       string
	onMessage   func(PushMessage)

	// Optional lifecycle callbacks for observability. Called with the
	// connection URL; nil callbacks are silently ignored.
	onConnect    func(url string) // called each time the stream is established
	onDisconnect func()           // called each time the stream drops (before reconnect)

	mu     sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}
}

// New creates a new SSE push client. fallbackURL is tried after 3 consecutive
// short-lived connection failures on the primary URL.
func New(url, fallbackURL, token string, onMessage func(PushMessage)) *Client {
	return &Client{
		url:         url,
		fallbackURL: fallbackURL,
		token:       token,
		onMessage:   onMessage,
		done:        make(chan struct{}),
	}
}

// WithLifecycleCallbacks attaches optional connect/disconnect observers.
// onConnect is called each time the SSE stream is successfully established;
// onDisconnect is called each time the stream drops before reconnecting.
// Either argument may be nil.
func (c *Client) WithLifecycleCallbacks(onConnect func(url string), onDisconnect func()) *Client {
	c.onConnect = onConnect
	c.onDisconnect = onDisconnect
	return c
}

// Connect blocks and maintains a persistent SSE connection with exponential
// backoff reconnection. Call Close() to stop.
func (c *Client) Connect() {
	ctx, cancel := context.WithCancel(context.Background())
	c.mu.Lock()
	c.cancel = cancel
	c.mu.Unlock()

	backoff := time.Second
	consecutiveFailures := 0
	const fallbackThreshold = 3

	for {
		start := time.Now()
		connected, err := c.stream(ctx)
		if ctx.Err() != nil {
			close(c.done)
			return
		}

		if time.Since(start) > 5*time.Second {
			backoff = time.Second
			consecutiveFailures = 0
		} else {
			consecutiveFailures++
		}

		if consecutiveFailures >= fallbackThreshold && c.fallbackURL != "" && c.url != c.fallbackURL {
			slog.Info("push: switching to fallback URL", "fallback", c.fallbackURL, "failures", consecutiveFailures)
			c.url = c.fallbackURL
			backoff = time.Second
			consecutiveFailures = 0
		}

		// Only fire onDisconnect if the stream was actually established at some
		// point during this call. Failures before the first successful connect
		// should not increment reconnect counters.
		if connected && c.onDisconnect != nil {
			c.onDisconnect()
		}
		slog.Warn("push: connection lost, reconnecting",
			"error", err, "url", c.url, "backoff", backoff)
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
// The bool return value indicates whether the stream was successfully established
// (i.e. onConnect was called); callers use this to guard onDisconnect so that
// a failure before the first connect does not trigger reconnect accounting.
func (c *Client) stream(ctx context.Context) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.url, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := sseHTTPClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, &httpError{StatusCode: resp.StatusCode}
	}

	slog.Info("push: connected", "url", c.url)
	if c.onConnect != nil {
		c.onConnect(c.url)
	}

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
		return true, err
	}
	return true, nil
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
