package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/TerrifiedBug/vectorflow/agent/internal/client"
)

// handleSelfUpdate downloads a new agent binary, verifies its checksum,
// atomically replaces the current executable, and re-execs the process.
// On success this function does not return (the process is replaced).
func (a *Agent) handleSelfUpdate(action *client.PendingAction) error {
	slog.Info("self-update requested", "targetVersion", action.TargetVersion, "url", action.DownloadURL)

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
	resp, err := http.Get(action.DownloadURL)
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
	actualHash := hex.EncodeToString(hasher.Sum(nil))
	expectedHash := strings.TrimPrefix(action.Checksum, "sha256:")
	expectedHash = strings.ToLower(strings.TrimSpace(expectedHash))

	if actualHash != expectedHash {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedHash, actualHash)
	}
	slog.Info("checksum verified", "sha256", actualHash)

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
