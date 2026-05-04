package agent

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
	"github.com/TerrifiedBug/vectorflow/agent/internal/config"
)

func TestLoadOrEnrollDoesNotLogTokenPrefix(t *testing.T) {
	const enrollmentToken = "vf_enroll_1234567890abcdef_secret_tail"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent/enroll" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		var req client.EnrollRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode enroll request: %v", err)
		}
		if req.Token != enrollmentToken {
			t.Fatalf("expected enrollment token to be sent to server")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"nodeId":"node-1","nodeToken":"node-token-1","environmentName":"prod"}`))
	}))
	defer server.Close()

	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })

	cfg := &config.Config{
		URL:       server.URL,
		Token:     enrollmentToken,
		DataDir:   t.TempDir(),
		VectorBin: "vector-binary-that-does-not-exist",
	}

	if _, err := loadOrEnroll(cfg, client.New(server.URL), nil); err != nil {
		t.Fatalf("loadOrEnroll returned error: %v", err)
	}

	output := logs.String()
	if strings.Contains(output, enrollmentToken) || strings.Contains(output, enrollmentToken[:24]) || strings.Contains(output, "tokenPrefix") {
		t.Fatalf("enrollment logs leaked token material: %s", output)
	}
}
