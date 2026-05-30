package logbuf

import (
	"bytes"
	"sync"
)

// maxLineBytes caps the length of a single buffered line. Lines longer than
// this are truncated so a pathological process cannot grow the partial-line
// accumulator without bound. It is well above bufio's default 64KiB token
// limit, which previously caused long lines to be dropped entirely.
const maxLineBytes = 1 << 20 // 1 MiB

// RingBuffer stores the last N lines written to it.
// It implements io.Writer so it can be used with io.MultiWriter.
type RingBuffer struct {
	mu      sync.Mutex
	lines   []string
	cap     int
	pos     int
	full    bool
	partial []byte // bytes of an incomplete trailing line carried across writes
}

// New creates a ring buffer that retains the last capacity lines.
func New(capacity int) *RingBuffer {
	if capacity < 1 {
		capacity = 1
	}
	return &RingBuffer{
		lines: make([]string, capacity),
		cap:   capacity,
	}
}

// Write implements io.Writer. It splits incoming bytes on newlines and stores
// each complete line. A trailing fragment without a newline is held in
// rb.partial and prepended to the next Write, so a single log line split
// across multiple writes is recorded as one line rather than several.
func (rb *RingBuffer) Write(p []byte) (n int, err error) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	buf := p
	if len(rb.partial) > 0 {
		buf = append(rb.partial, p...)
	}

	for {
		idx := bytes.IndexByte(buf, '\n')
		if idx < 0 {
			break
		}
		line := buf[:idx]
		// Strip a trailing CR so CRLF-terminated lines aren't stored with a
		// stray '\r'.
		if len(line) > 0 && line[len(line)-1] == '\r' {
			line = line[:len(line)-1]
		}
		rb.appendLine(line)
		buf = buf[idx+1:]
	}

	// Whatever remains is an incomplete line; carry it to the next write.
	// Copy it out of the (possibly aliased) input slice so the caller may
	// reuse p, and cap it to avoid unbounded growth.
	if len(buf) > maxLineBytes {
		buf = buf[len(buf)-maxLineBytes:]
	}
	rb.partial = append(rb.partial[:0], buf...)

	return len(p), nil
}

// appendLine records a single complete line into the ring. Callers hold rb.mu.
func (rb *RingBuffer) appendLine(line []byte) {
	if len(line) > maxLineBytes {
		line = line[:maxLineBytes]
	}
	rb.lines[rb.pos] = string(line)
	rb.pos = (rb.pos + 1) % rb.cap
	if rb.pos == 0 {
		rb.full = true
	}
}

// Lines returns all buffered lines in order and clears the buffer. Any
// incomplete trailing line (not yet newline-terminated) is also flushed so
// log output is not lost when a process exits without a final newline.
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

	// Flush any buffered partial line as a final entry.
	if len(rb.partial) > 0 {
		result = append(result, string(rb.partial))
		rb.partial = rb.partial[:0]
	}

	// Clear buffer
	rb.pos = 0
	rb.full = false

	return result
}
