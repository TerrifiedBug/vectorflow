package agent

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/config"
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
	if transport.Proxy == nil {
		t.Fatal("expected proxy support via environment variables")
	}
}

func TestHandleSelfUpdateRejectsNonHTTPS(t *testing.T) {
	a := &Agent{cfg: &config.Config{}}
	err := a.handleSelfUpdate(&client.PendingAction{
		Type:          "self_update",
		TargetVersion: "v1.2.3",
		DownloadURL:   "http://example.com/vf-agent",
		Checksum:      "sha256:deadbeef",
	})
	if err == nil {
		t.Fatal("expected self-update over http:// to be refused")
	}
	if !strings.Contains(err.Error(), "https is required") {
		t.Fatalf("expected an https-required error, got: %v", err)
	}
}

func TestVerifyUpdateSignature(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pubB64 := base64.StdEncoding.EncodeToString(pub)
	msg := []byte("the binary digest")
	sigB64 := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, msg))

	t.Run("valid signature verifies", func(t *testing.T) {
		if err := verifyUpdateSignature(pubB64, sigB64, msg); err != nil {
			t.Fatalf("expected valid signature to verify, got: %v", err)
		}
	})

	t.Run("wrong message is rejected", func(t *testing.T) {
		if err := verifyUpdateSignature(pubB64, sigB64, []byte("tampered")); err == nil {
			t.Fatal("expected signature over a different message to be rejected")
		}
	})

	t.Run("missing signature is rejected when key is set", func(t *testing.T) {
		if err := verifyUpdateSignature(pubB64, "", msg); err == nil {
			t.Fatal("expected a missing signature to be rejected")
		}
	})

	t.Run("malformed public key is rejected", func(t *testing.T) {
		if err := verifyUpdateSignature("not-base64!!", sigB64, msg); err == nil {
			t.Fatal("expected a malformed public key to be rejected")
		}
	})

	t.Run("wrong-size key is rejected", func(t *testing.T) {
		short := base64.StdEncoding.EncodeToString([]byte("too-short"))
		if err := verifyUpdateSignature(short, sigB64, msg); err == nil {
			t.Fatal("expected a wrong-size key to be rejected")
		}
	})

	t.Run("signature from a different key is rejected", func(t *testing.T) {
		_, priv2, _ := ed25519.GenerateKey(rand.Reader)
		otherSig := base64.StdEncoding.EncodeToString(ed25519.Sign(priv2, msg))
		if err := verifyUpdateSignature(pubB64, otherSig, msg); err == nil {
			t.Fatal("expected a signature from a different key to be rejected")
		}
	})
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

func TestUpdateHTTPClientUsesProxyFromEnvironment(t *testing.T) {
	transport, ok := updateHTTPClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("expected *http.Transport, got %T", updateHTTPClient.Transport)
	}
	if reflect.ValueOf(transport.Proxy).Pointer() != reflect.ValueOf(http.ProxyFromEnvironment).Pointer() {
		t.Fatal("expected self-update client to use http.ProxyFromEnvironment")
	}
}
