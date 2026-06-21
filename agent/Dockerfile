# Stage 1: Build Go agent
# Runs on the build platform and cross-compiles to the target arch so multi-arch
# builds (linux/amd64 + linux/arm64) don't pay for QEMU emulation of the toolchain.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY . .
ARG VERSION=dev
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags="-s -w -X github.com/TerrifiedBug/vectorflow/agent/internal/agent.Version=${VERSION}" -o /vf-agent .

# Stage 2: Download Vector for the target architecture
# Keep this default in sync with src/lib/vector-version.ts (canonical source).
FROM alpine:3.24 AS vector
ARG VECTOR_VERSION=0.54.0
ARG TARGETARCH
RUN apk add --no-cache curl && \
    case "${TARGETARCH}" in \
      amd64) VECTOR_ARCH=x86_64 ;; \
      arm64) VECTOR_ARCH=aarch64 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    curl -sSfL -o /tmp/vector.tar.gz \
      "https://packages.timber.io/vector/${VECTOR_VERSION}/vector-${VECTOR_VERSION}-${VECTOR_ARCH}-unknown-linux-musl.tar.gz" && \
    tar xzf /tmp/vector.tar.gz -C /tmp && \
    cp "/tmp/vector-${VECTOR_ARCH}-unknown-linux-musl/bin/vector" /usr/local/bin/vector

# Stage 3: Runtime
FROM alpine:3.24
RUN apk add --no-cache ca-certificates su-exec
COPY --from=builder /vf-agent /usr/local/bin/vf-agent
COPY --from=vector /usr/local/bin/vector /usr/local/bin/vector
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENV VF_VECTOR_BIN=/usr/local/bin/vector
ENV VF_DATA_DIR=/var/lib/vf-agent
RUN mkdir -p /var/lib/vf-agent /var/lib/vector
ENTRYPOINT ["docker-entrypoint.sh"]
