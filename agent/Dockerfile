# Stage 1: Build Go agent
FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -ldflags="-s -w -X github.com/TerrifiedBug/vectorflow/agent/internal/agent.Version=${VERSION}" -o /vf-agent .

# Stage 2: Download Vector
FROM alpine:3.21 AS vector
ARG VECTOR_VERSION=0.54.0
RUN apk add --no-cache curl && \
    curl -sSfL -o /tmp/vector.tar.gz \
      "https://packages.timber.io/vector/${VECTOR_VERSION}/vector-${VECTOR_VERSION}-x86_64-unknown-linux-musl.tar.gz" && \
    tar xzf /tmp/vector.tar.gz -C /tmp && \
    cp /tmp/vector-x86_64-unknown-linux-musl/bin/vector /usr/local/bin/vector

# Stage 3: Runtime
# NOTE: The agent runs as root because Vector sources (docker_logs, file)
# need access to the Docker socket and host filesystem paths.
FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /vf-agent /usr/local/bin/vf-agent
COPY --from=vector /usr/local/bin/vector /usr/local/bin/vector
ENV VF_VECTOR_BIN=/usr/local/bin/vector
ENV VF_DATA_DIR=/var/lib/vf-agent
RUN mkdir -p /var/lib/vf-agent /var/lib/vector
ENTRYPOINT ["vf-agent"]
