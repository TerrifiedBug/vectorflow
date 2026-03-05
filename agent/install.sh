#!/usr/bin/env bash
# VectorFlow Agent Installer
# Usage: curl -sSfL https://raw.githubusercontent.com/TerrifiedBug/vectorflow/main/agent/install.sh | sudo bash -s -- [OPTIONS]

set -euo pipefail

REPO="TerrifiedBug/vectorflow"
INSTALL_DIR="/usr/local/bin"
DATA_DIR="/var/lib/vf-agent"
VECTOR_DATA_DIR="/var/lib/vector"
CONFIG_DIR="/etc/vectorflow"
ENV_FILE="${CONFIG_DIR}/agent.env"
SERVICE_NAME="vf-agent"
VECTOR_VERSION="0.44.0"

# Defaults
VF_URL=""
VF_TOKEN=""
VERSION="latest"
CHANNEL="stable"

# ─────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────

info()  { printf '\033[1;34m[info]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[1;32m[ok]\033[0m    %s\n' "$*"; }
warn()  { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }
fatal() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
VectorFlow Agent Installer

Usage:
  curl -sSfL https://raw.githubusercontent.com/TerrifiedBug/vectorflow/main/agent/install.sh | \
    sudo bash -s -- [OPTIONS]

Options:
  --url <url>        VectorFlow server URL (e.g. https://vectorflow.example.com)
  --token <token>    One-time enrollment token from the VectorFlow UI
  --version <tag>    Release version to install (default: latest)
  --channel <name>   Release channel: stable or dev (default: stable)
  --help             Show this help message

Examples:
  # Fresh install
  curl -sSfL .../install.sh | sudo bash -s -- --url https://vf.example.com --token abc123

  # Upgrade to latest
  curl -sSfL .../install.sh | sudo bash

  # Install specific version
  curl -sSfL .../install.sh | sudo bash -s -- --version v0.3.0

  # Install dev channel
  curl -sSfL .../install.sh | sudo bash -s -- --channel dev --url https://vf.example.com --token abc123
EOF
    exit 0
}

# ─────────────────────────────────────────────────
# Argument parsing
# ─────────────────────────────────────────────────

while [ $# -gt 0 ]; do
    case "$1" in
        --url)    VF_URL="$2";   shift 2 ;;
        --token)  VF_TOKEN="$2"; shift 2 ;;
        --version) VERSION="$2"; shift 2 ;;
        --channel) CHANNEL="$2";  shift 2 ;;
        --help)   usage ;;
        *)        fatal "Unknown option: $1 (use --help for usage)" ;;
    esac
done

if [ "${CHANNEL}" = "dev" ] && [ "${VERSION}" != "latest" ]; then
    fatal "--channel dev and --version are mutually exclusive"
fi

# ─────────────────────────────────────────────────
# Preflight checks
# ─────────────────────────────────────────────────

info "Running preflight checks..."

[ "$(uname -s)" = "Linux" ] || fatal "This installer only supports Linux"
[ "$(id -u)" -eq 0 ]        || fatal "Please run as root (use sudo)"
command -v curl >/dev/null   || fatal "curl is required but not found"
command -v systemctl >/dev/null || fatal "systemd is required but not found"

# ─────────────────────────────────────────────────
# Detect architecture
# ─────────────────────────────────────────────────

UNAME_ARCH="$(uname -m)"
case "${UNAME_ARCH}" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    arm64)   ARCH="arm64" ;;
    *)       fatal "Unsupported architecture: ${UNAME_ARCH}" ;;
esac
info "Detected architecture: ${ARCH}"

# ─────────────────────────────────────────────────
# Resolve version
# ─────────────────────────────────────────────────

if [ "${CHANNEL}" = "dev" ]; then
    info "Using dev channel..."
    VERSION="dev"
    BINARY_NAME="vf-agent-linux-${ARCH}"
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/dev/${BINARY_NAME}"
    CHECKSUM_URL="https://github.com/${REPO}/releases/download/dev/checksums.txt"
else
    if [ "${VERSION}" = "latest" ]; then
        info "Resolving latest release..."
        VERSION=$(curl -sSf "https://api.github.com/repos/${REPO}/releases/latest" \
            | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
        [ -n "${VERSION}" ] || fatal "Could not determine latest release version"
    fi
    info "Target version: ${VERSION}"

    BINARY_NAME="vf-agent-linux-${ARCH}"
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY_NAME}"
    CHECKSUM_URL="https://github.com/${REPO}/releases/download/${VERSION}/checksums.txt"
fi

# ─────────────────────────────────────────────────
# Download and verify agent binary
# ─────────────────────────────────────────────────

TMPDIR=$(mktemp -d)
trap 'rm -rf "${TMPDIR}"' EXIT

info "Downloading ${BINARY_NAME}..."
curl -sSfL -o "${TMPDIR}/${BINARY_NAME}" "${DOWNLOAD_URL}" \
    || fatal "Failed to download binary from ${DOWNLOAD_URL}"

info "Verifying checksum..."
curl -sSfL -o "${TMPDIR}/checksums.txt" "${CHECKSUM_URL}" \
    || fatal "Failed to download checksums from ${CHECKSUM_URL}"

(cd "${TMPDIR}" && grep "${BINARY_NAME}" checksums.txt | sha256sum -c --quiet) \
    || fatal "Checksum verification failed — aborting"
ok "Checksum verified"

# ─────────────────────────────────────────────────
# Install agent binary
# ─────────────────────────────────────────────────

info "Installing vf-agent to ${INSTALL_DIR}..."
install -m 755 "${TMPDIR}/${BINARY_NAME}" "${INSTALL_DIR}/vf-agent"
ok "Installed vf-agent $(${INSTALL_DIR}/vf-agent --version 2>/dev/null || echo "${VERSION}")"

# ─────────────────────────────────────────────────
# Install Vector (if not present)
# ─────────────────────────────────────────────────

if command -v vector >/dev/null; then
    ok "Vector already installed: $(vector --version 2>/dev/null || echo 'unknown version')"
else
    info "Vector not found — installing v${VECTOR_VERSION}..."

    case "${ARCH}" in
        amd64) VECTOR_ARCH="x86_64" ;;
        arm64) VECTOR_ARCH="aarch64" ;;
    esac

    VECTOR_TARBALL="vector-${VECTOR_VERSION}-${VECTOR_ARCH}-unknown-linux-musl.tar.gz"
    VECTOR_URL="https://packages.timber.io/vector/${VECTOR_VERSION}/${VECTOR_TARBALL}"

    curl -sSfL -o "${TMPDIR}/${VECTOR_TARBALL}" "${VECTOR_URL}" \
        || fatal "Failed to download Vector from ${VECTOR_URL}"

    tar -xzf "${TMPDIR}/${VECTOR_TARBALL}" -C "${TMPDIR}"
    VECTOR_DIR=$(find "${TMPDIR}" -maxdepth 1 -type d -name "vector-*" | head -1)
    [ -d "${VECTOR_DIR}" ] || fatal "Could not find extracted Vector directory"

    install -m 755 "${VECTOR_DIR}/bin/vector" "${INSTALL_DIR}/vector"
    ok "Installed Vector v${VECTOR_VERSION}"
fi

# ─────────────────────────────────────────────────
# Create directories
# ─────────────────────────────────────────────────

info "Creating directories..."
install -d -m 0700 "${DATA_DIR}"
install -d -m 0755 "${VECTOR_DATA_DIR}"
install -d -m 0755 "${CONFIG_DIR}"

# ─────────────────────────────────────────────────
# Write environment file (preserve on upgrade)
# ─────────────────────────────────────────────────

if [ -f "${ENV_FILE}" ]; then
    warn "Existing ${ENV_FILE} found — preserving (edit manually to change settings)"
else
    info "Writing ${ENV_FILE}..."
    cat > "${ENV_FILE}" <<ENVEOF
# VectorFlow Agent Configuration
# See: https://github.com/${REPO}#agent

VF_URL=${VF_URL}
VF_TOKEN=${VF_TOKEN}
VF_DATA_DIR=${DATA_DIR}
VF_VECTOR_BIN=${INSTALL_DIR}/vector
# Channel is for human reference only — the agent infers channel from its version string
VF_CHANNEL=${CHANNEL}
ENVEOF
    chmod 0600 "${ENV_FILE}"
    ok "Environment file written"

    if [ -z "${VF_URL}" ]; then
        warn "VF_URL is empty — edit ${ENV_FILE} before starting the service"
    fi
fi

# ─────────────────────────────────────────────────
# Write systemd unit
# ─────────────────────────────────────────────────

info "Writing systemd unit..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<'UNITEOF'
[Unit]
Description=VectorFlow Agent
Documentation=https://github.com/TerrifiedBug/vectorflow
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/vectorflow/agent.env
ExecStart=/usr/local/bin/vf-agent
Restart=on-failure
RestartSec=5
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNITEOF

# ─────────────────────────────────────────────────
# Enable and start service
# ─────────────────────────────────────────────────

info "Enabling and starting ${SERVICE_NAME}..."
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" --quiet
systemctl restart "${SERVICE_NAME}"

# ─────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────

echo ""
ok "VectorFlow Agent installed successfully!"
echo ""
echo "  Service status:   systemctl status ${SERVICE_NAME}"
echo "  Follow logs:      journalctl -u ${SERVICE_NAME} -f"
echo "  Configuration:    ${ENV_FILE}"
echo "  Restart:          systemctl restart ${SERVICE_NAME}"
echo ""

if [ -z "${VF_URL}" ] && [ ! -f "${ENV_FILE}" ]; then
    warn "Don't forget to set VF_URL and VF_TOKEN in ${ENV_FILE}, then restart:"
    echo "    sudo systemctl restart ${SERVICE_NAME}"
    echo ""
fi
