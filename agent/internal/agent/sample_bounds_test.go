package agent

import "testing"

// VF-24: sample requests must be bounded so a buggy/compromised control plane
// cannot fork-bomb the host with `vector tap` subprocesses.

func TestClampSampleLimit(t *testing.T) {
	cases := []struct {
		in, want int
	}{
		{in: 0, want: 1},
		{in: -5, want: 1},
		{in: 50, want: 50},
		{in: maxSampleLimit, want: maxSampleLimit},
		{in: maxSampleLimit + 1, want: maxSampleLimit},
		{in: 1 << 30, want: maxSampleLimit},
	}
	for _, c := range cases {
		if got := clampSampleLimit(c.in); got != c.want {
			t.Errorf("clampSampleLimit(%d) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestBoundComponentKeys(t *testing.T) {
	t.Run("under the cap is unchanged", func(t *testing.T) {
		keys := []string{"a", "b", "c"}
		got := boundComponentKeys(keys)
		if len(got) != 3 {
			t.Fatalf("expected 3 keys, got %d", len(got))
		}
	})

	t.Run("over the cap is truncated", func(t *testing.T) {
		keys := make([]string, maxComponentKeysPerSample+10)
		for i := range keys {
			keys[i] = "k"
		}
		got := boundComponentKeys(keys)
		if len(got) != maxComponentKeysPerSample {
			t.Fatalf("expected %d keys after truncation, got %d", maxComponentKeysPerSample, len(got))
		}
	})
}

func TestSampleTapSemaphoreIsBounded(t *testing.T) {
	if cap(sampleTapSem) != maxConcurrentSampleTaps {
		t.Fatalf("expected sample tap semaphore capacity %d, got %d", maxConcurrentSampleTaps, cap(sampleTapSem))
	}
	if maxConcurrentSampleTaps <= 0 {
		t.Fatal("concurrent sample taps must be a positive bound")
	}
}

// VF-40: the node Bearer token must only be sent to a push URL that matches the
// configured VF_URL scheme and host.

func TestPushURLMatchesConfigured(t *testing.T) {
	cases := []struct {
		name     string
		push, vf string
		wantOK   bool
	}{
		{name: "exact https match", push: "https://vf.example.com/api/agent/push", vf: "https://vf.example.com", wantOK: true},
		{name: "http downgrade rejected", push: "http://vf.example.com/api/agent/push", vf: "https://vf.example.com", wantOK: false},
		{name: "different host rejected", push: "https://evil.example.com/api/agent/push", vf: "https://vf.example.com", wantOK: false},
		{name: "host with matching port ok", push: "https://vf.example.com:8443/api/agent/push", vf: "https://vf.example.com:8443", wantOK: true},
		{name: "mismatched port rejected", push: "https://vf.example.com:9999/api/agent/push", vf: "https://vf.example.com:8443", wantOK: false},
		{name: "localhost http dev match", push: "http://localhost:3000/api/agent/push", vf: "http://localhost:3000", wantOK: true},
		{name: "empty push host rejected", push: "/api/agent/push", vf: "https://vf.example.com", wantOK: false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := pushURLMatchesConfigured(c.push, c.vf); got != c.wantOK {
				t.Errorf("pushURLMatchesConfigured(%q, %q) = %v, want %v", c.push, c.vf, got, c.wantOK)
			}
		})
	}
}
