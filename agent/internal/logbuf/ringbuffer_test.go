package logbuf

import (
	"strings"
	"testing"
)

func TestWriteCompleteLines(t *testing.T) {
	rb := New(10)
	if _, err := rb.Write([]byte("alpha\nbravo\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	got := rb.Lines()
	want := []string{"alpha", "bravo"}
	assertLines(t, got, want)
}

// A single logical line delivered across multiple writes must be stored as one
// line, not one line per write fragment.
func TestWriteSplitLineAcrossWrites(t *testing.T) {
	rb := New(10)
	rb.Write([]byte("hello, "))
	rb.Write([]byte("wor"))
	rb.Write([]byte("ld\n"))

	got := rb.Lines()
	assertLines(t, got, []string{"hello, world"})
}

// Multiple newlines arriving in one write are split correctly, with a trailing
// fragment carried to the next write.
func TestWriteMultipleLinesPlusTrailingFragment(t *testing.T) {
	rb := New(10)
	rb.Write([]byte("one\ntwo\nthr"))
	rb.Write([]byte("ee\n"))

	assertLines(t, rb.Lines(), []string{"one", "two", "three"})
}

// A long line that exceeds bufio's default 64KiB scanner token limit must be
// retained, not dropped.
func TestWriteLongLineNotDropped(t *testing.T) {
	rb := New(10)
	long := strings.Repeat("x", 100*1024) // 100 KiB, > 64 KiB bufio default
	rb.Write([]byte(long + "\n"))

	got := rb.Lines()
	if len(got) != 1 {
		t.Fatalf("expected 1 line, got %d", len(got))
	}
	if len(got[0]) != len(long) {
		t.Fatalf("expected line length %d, got %d", len(long), len(got[0]))
	}
}

// A line longer than maxLineBytes is truncated rather than dropped or allowed
// to grow without bound.
func TestWriteVeryLongLineTruncated(t *testing.T) {
	rb := New(10)
	huge := strings.Repeat("y", maxLineBytes+5000)
	rb.Write([]byte(huge + "\n"))

	got := rb.Lines()
	if len(got) != 1 {
		t.Fatalf("expected 1 line, got %d", len(got))
	}
	if len(got[0]) != maxLineBytes {
		t.Fatalf("expected truncated length %d, got %d", maxLineBytes, len(got[0]))
	}
}

// CRLF-terminated lines should not retain a trailing carriage return.
func TestWriteStripsCarriageReturn(t *testing.T) {
	rb := New(10)
	rb.Write([]byte("windows\r\nunix\n"))

	assertLines(t, rb.Lines(), []string{"windows", "unix"})
}

// An incomplete trailing line (no newline) is flushed on read so log output is
// not lost when a process exits without a final newline.
func TestLinesFlushesPartial(t *testing.T) {
	rb := New(10)
	rb.Write([]byte("done\nincomplete"))

	assertLines(t, rb.Lines(), []string{"done", "incomplete"})

	// After flushing, a second read returns nothing.
	if got := rb.Lines(); len(got) != 0 {
		t.Fatalf("expected empty after flush, got %v", got)
	}
}

// The buffer retains only the last `capacity` lines once it wraps.
func TestWriteRingWraparound(t *testing.T) {
	rb := New(3)
	for _, l := range []string{"a", "b", "c", "d", "e"} {
		rb.Write([]byte(l + "\n"))
	}
	assertLines(t, rb.Lines(), []string{"c", "d", "e"})
}

// Lines() clears the buffer; a subsequent read returns nothing.
func TestLinesClearsBuffer(t *testing.T) {
	rb := New(10)
	rb.Write([]byte("x\ny\n"))
	_ = rb.Lines()
	if got := rb.Lines(); len(got) != 0 {
		t.Fatalf("expected empty after clear, got %v", got)
	}
}

// New clamps a non-positive capacity to 1 so modulo math never divides by zero.
func TestNewClampsCapacity(t *testing.T) {
	rb := New(0)
	rb.Write([]byte("a\nb\n"))
	got := rb.Lines()
	if len(got) != 1 || got[0] != "b" {
		t.Fatalf("expected last line only, got %v", got)
	}
}

func assertLines(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("line count: got %d %v, want %d %v", len(got), got, len(want), want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("line %d: got %q, want %q", i, got[i], want[i])
		}
	}
}
