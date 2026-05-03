package agent

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
)

func TestUpdateHTTPClientHasExplicitTimeouts(t *testing.T) {
	if updateHTTPClient.Timeout <= 0 {
		t.Fatal("expected self-update client to have an overall timeout")
	}

	transport, ok := updateHTTPClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("expected *http.Transport, got %T", updateHTTPClient.Transport)
	}
	if transport.ResponseHeaderTimeout <= 0 {
		t.Fatal("expected response header timeout for stalled reads")
	}
	if transport.TLSHandshakeTimeout <= 0 {
		t.Fatal("expected TLS handshake timeout")
	}
	if transport.DialContext == nil {
		t.Fatal("expected explicit dial timeout")
	}
}

func TestHandlePendingActionRetriesFailedUpdateAfterBackoff(t *testing.T) {
	original := updateRetryBackoff
	updateRetryBackoff = time.Minute
	t.Cleanup(func() { updateRetryBackoff = original })

	attempts := 0
	a := &Agent{
		selfUpdate: func(action *client.PendingAction) error {
			attempts++
			return errors.New("download failed")
		},
	}
	action := &client.PendingAction{
		Type:          "self_update",
		TargetVersion: "v1.2.3",
	}

	a.handlePendingAction(action)
	a.handlePendingAction(action)
	if attempts != 1 {
		t.Fatalf("expected retry to be suppressed during backoff, got %d attempts", attempts)
	}

	a.failedUpdateAt = time.Now().Add(-updateRetryBackoff - time.Second)
	a.handlePendingAction(action)
	if attempts != 2 {
		t.Fatalf("expected failed update to retry after backoff, got %d attempts", attempts)
	}
}

func TestUpdateHTTPClientCanReachNonRoutableHostWithoutHangingForever(t *testing.T) {
	if updateHTTPClient.Timeout > 35*time.Second {
		t.Fatalf("update timeout should be bounded near 30s, got %s", updateHTTPClient.Timeout)
	}
}
