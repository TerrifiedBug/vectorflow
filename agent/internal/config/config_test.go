package config

import (
	"testing"
)

func TestLoad_MetricsPort(t *testing.T) {
	tests := []struct {
		name      string
		envVal    string
		wantPort  int
		wantError bool
	}{
		{"default (unset)", "", 9090, false},
		{"disabled with zero", "0", 0, false},
		{"explicit default port", "9090", 9090, false},
		{"max valid port", "65535", 65535, false},
		{"custom valid port", "8080", 8080, false},
		{"negative port", "-1", 0, true},
		{"above max port", "65536", 0, true},
		{"non-numeric", "abc", 0, true},
		{"empty string treated as default", "", 9090, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("VF_URL", "http://localhost:8080")
			if tt.envVal != "" {
				t.Setenv("VF_METRICS_PORT", tt.envVal)
			} else {
				t.Setenv("VF_METRICS_PORT", "")
			}

			cfg, err := Load()
			if tt.wantError {
				if err == nil {
					t.Errorf("expected error for VF_METRICS_PORT=%q, got nil", tt.envVal)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for VF_METRICS_PORT=%q: %v", tt.envVal, err)
			}
			if cfg.MetricsPort != tt.wantPort {
				t.Errorf("VF_METRICS_PORT=%q: got %d, want %d", tt.envVal, cfg.MetricsPort, tt.wantPort)
			}
		})
	}
}
