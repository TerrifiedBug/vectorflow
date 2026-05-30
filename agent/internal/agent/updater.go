package agent

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
)

var updateRetryBackoff = 5 * time.Minute

var updateHTTPClient = &http.Client{
	Timeout: 30 * time.Second,
	Transport: &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	},
	// Re-validate the scheme on every redirect hop. The up-front https check on
	// action.DownloadURL only inspects the initial URL; without this, an https
	// URL that 3xx-redirects to plain http would be followed over cleartext,
	// defeating the downgrade/MITM protection for a re-exec-as-root binary.
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if !strings.EqualFold(req.URL.Scheme, "https") {
			return fmt.Errorf("refusing self-update redirect to insecure scheme %q: https is required", req.URL.Scheme)
		}
		if len(via) >= 10 {
			return fmt.Errorf("stopped after 10 redirects")
		}
		return nil
	},
}

// handleSelfUpdate downloads a new agent binary, verifies its checksum,
// atomically replaces the current executable, and re-execs the process.
// On success this function does not return (the process is replaced).
func (a *Agent) handleSelfUpdate(action *client.PendingAction) error {
	slog.Info("self-update requested", "targetVersion", action.TargetVersion, "url", action.DownloadURL)

	// Refuse to fetch the binary over an insecure scheme. The download URL
	// comes from the server; a plain-http URL is a downgrade/MITM vector for
	// what becomes a re-exec as (often root) the agent user.
	parsedURL, err := url.Parse(action.DownloadURL)
	if err != nil {
		return fmt.Errorf("parse download url: %w", err)
	}
	if !strings.EqualFold(parsedURL.Scheme, "https") {
		return fmt.Errorf("refusing self-update over insecure scheme %q: https is required", parsedURL.Scheme)
	}

	// Download the new binary to a temp file next to the current executable
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable path: %w", err)
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return fmt.Errorf("resolve executable symlinks: %w", err)
	}

	tmpFile, err := os.CreateTemp(filepath.Dir(execPath), ".vectorflow-agent-update-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer func() {
		// Clean up temp file on any error path
		tmpFile.Close()
		os.Remove(tmpPath)
	}()

	slog.Info("downloading update", "url", action.DownloadURL)
	resp, err := updateHTTPClient.Get(action.DownloadURL)
	if err != nil {
		return fmt.Errorf("download binary: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	// Write to temp file and compute SHA256 simultaneously
	hasher := sha256.New()
	writer := io.MultiWriter(tmpFile, hasher)

	if _, err := io.Copy(writer, resp.Body); err != nil {
		return fmt.Errorf("write downloaded binary: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("close temp file: %w", err)
	}

	// Verify checksum
	digest := hasher.Sum(nil)
	actualHash := hex.EncodeToString(digest)
	expectedHash := strings.TrimPrefix(action.Checksum, "sha256:")
	expectedHash = strings.ToLower(strings.TrimSpace(expectedHash))

	if actualHash != expectedHash {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedHash, actualHash)
	}
	slog.Info("checksum verified", "sha256", actualHash)

	// Verify publisher signature. The checksum only proves the bytes match what
	// the server said to expect — a compromised server could supply both a
	// malicious binary and its matching checksum. An ed25519 signature over the
	// digest, checked against a key pinned in the agent's environment, closes
	// the server-compromise → fleet-wide-RCE path.
	if a.cfg.UpdatePublicKey != "" {
		if err := verifyUpdateSignature(a.cfg.UpdatePublicKey, action.Signature, digest); err != nil {
			return fmt.Errorf("self-update signature verification failed: %w", err)
		}
		slog.Info("update signature verified")
	} else {
		slog.Warn("VF_UPDATE_PUBLIC_KEY is not set — self-update is verified by checksum only; " +
			"set it to a base64 ed25519 public key to require publisher-signed updates")
	}

	// Make the new binary executable
	if err := os.Chmod(tmpPath, 0755); err != nil {
		return fmt.Errorf("chmod temp binary: %w", err)
	}

	// Atomic replace: rename temp file over current executable
	if err := os.Rename(tmpPath, execPath); err != nil {
		return fmt.Errorf("replace executable: %w", err)
	}

	// Shut down all pipelines before re-exec to avoid orphaned Vector processes
	// and port conflicts when the new agent starts them again.
	slog.Info("stopping all pipelines before re-exec")
	a.supervisor.ShutdownAll()

	slog.Info("binary replaced, re-executing", "path", execPath, "version", action.TargetVersion)

	// Re-exec the process — this replaces the current process entirely
	if err := syscall.Exec(execPath, os.Args, os.Environ()); err != nil {
		return fmt.Errorf("exec new binary: %w", err)
	}

	// unreachable — syscall.Exec replaces the process
	return nil
}

// verifyUpdateSignature checks an ed25519 signature over the update binary's
// SHA256 digest against a pinned base64 public key. Returns an error (fail
// closed) if the key/signature is missing, malformed, or does not verify.
func verifyUpdateSignature(pubKeyB64, sigB64 string, message []byte) error {
	if strings.TrimSpace(sigB64) == "" {
		return fmt.Errorf("no signature on update but VF_UPDATE_PUBLIC_KEY is set")
	}
	pub, err := base64.StdEncoding.DecodeString(strings.TrimSpace(pubKeyB64))
	if err != nil {
		return fmt.Errorf("decode VF_UPDATE_PUBLIC_KEY: %w", err)
	}
	if len(pub) != ed25519.PublicKeySize {
		return fmt.Errorf("VF_UPDATE_PUBLIC_KEY is not a %d-byte ed25519 key (got %d bytes)", ed25519.PublicKeySize, len(pub))
	}
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(sigB64))
	if err != nil {
		return fmt.Errorf("decode signature: %w", err)
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), message, sig) {
		return fmt.Errorf("signature does not verify against the pinned public key")
	}
	return nil
}
