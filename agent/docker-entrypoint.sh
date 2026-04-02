#!/bin/sh
set -e

# If VF_AGENT_USER is set, create the user (if needed) and switch to it.
# Otherwise run as the current user (root by default).
if [ -n "${VF_AGENT_USER}" ]; then
  # Create system user if it doesn't exist
  if ! id "${VF_AGENT_USER}" >/dev/null 2>&1; then
    adduser -S -D -H -s /sbin/nologin "${VF_AGENT_USER}"
  fi

  # Ensure data directories are owned by the target user
  chown -R "${VF_AGENT_USER}" "${VF_DATA_DIR:-/var/lib/vf-agent}" /var/lib/vector

  exec su-exec "${VF_AGENT_USER}" vf-agent "$@"
fi

exec vf-agent "$@"
