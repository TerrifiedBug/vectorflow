package logbuf

import (
	"bufio"
	"bytes"
	"sync"
)

// RingBuffer stores the last N lines written to it.
// It implements io.Writer so it can be used with io.MultiWriter.
type RingBuffer struct {
	mu    sync.Mutex
	lines []string
	cap   int
	pos   int
	full  bool
}

// New creates a ring buffer that retains the last capacity lines.
func New(capacity int) *RingBuffer {
	return &RingBuffer{
		lines: make([]string, capacity),
		cap:   capacity,
	}
}

// Write implements io.Writer. It scans incoming bytes for newline-delimited lines.
func (rb *RingBuffer) Write(p []byte) (n int, err error) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	scanner := bufio.NewScanner(bytes.NewReader(p))
	for scanner.Scan() {
		line := scanner.Text()
		rb.lines[rb.pos] = line
		rb.pos = (rb.pos + 1) % rb.cap
		if rb.pos == 0 {
			rb.full = true
		}
	}
	return len(p), nil
}

// Lines returns all buffered lines in order and clears the buffer.
func (rb *RingBuffer) Lines() []string {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	var result []string
	if rb.full {
		result = make([]string, 0, rb.cap)
		for i := rb.pos; i < rb.cap; i++ {
			result = append(result, rb.lines[i])
		}
		for i := 0; i < rb.pos; i++ {
			result = append(result, rb.lines[i])
		}
	} else {
		result = make([]string, 0, rb.pos)
		for i := 0; i < rb.pos; i++ {
			result = append(result, rb.lines[i])
		}
	}

	// Clear buffer
	rb.pos = 0
	rb.full = false

	return result
}
