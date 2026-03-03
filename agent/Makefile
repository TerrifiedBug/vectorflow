.PHONY: build build-all clean docker

VERSION ?= dev
LDFLAGS := -ldflags="-s -w -X github.com/TerrifiedBug/vectorflow/agent/internal/agent.Version=$(VERSION)"

build:
	CGO_ENABLED=0 go build $(LDFLAGS) -o bin/vf-agent .

build-all:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o bin/vf-agent-linux-amd64 .
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o bin/vf-agent-linux-arm64 .

docker:
	docker build -t ghcr.io/terrifiedbug/vectorflow-agent:$(VERSION) .

clean:
	rm -rf bin/
