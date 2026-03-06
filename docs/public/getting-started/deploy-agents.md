# Deploy Agents

The VectorFlow agent (`vf-agent`) is a lightweight Go binary that runs on each node in your fleet. It manages Vector processes, pulls pipeline configurations from the server, and reports health via heartbeats.

{% hint style="info" %}
**Pull-based architecture** -- agents poll the server for config updates. No inbound ports are required on your fleet nodes. The agent initiates all connections, making it firewall-friendly and easy to deploy behind NAT.
{% endhint %}

## How it works

1. The agent starts and **enrolls** with the VectorFlow server using a one-time enrollment token
2. After enrollment, the server issues a persistent **node token** stored on disk
3. The agent **polls** the server every 15 seconds (configurable) for pipeline configuration changes
4. When a new config is received, the agent writes it to disk and starts or restarts the Vector process
5. The agent sends **heartbeats** with host metrics (CPU, memory, disk, network) so the server can track fleet health

Each pipeline runs as an isolated Vector process -- a crash in one pipeline does not affect others.

## Enrollment flow

{% stepper %}
{% step %}
### Generate an enrollment token

In the VectorFlow UI, navigate to the **Fleet** page. Select the environment you want to enroll the agent into, then click **Add Node**.

VectorFlow generates a one-time enrollment token. Copy it -- you will need it in the next step.

{% hint style="warning" %}
Enrollment tokens are single-use. Each agent needs its own token. Generate a new one for each node you want to enroll.
{% endhint %}
{% endstep %}

{% step %}
### Deploy the agent

Choose one of the deployment methods below and start the agent with the enrollment token.
{% endstep %}

{% step %}
### Verify enrollment

Once the agent starts, it enrolls with the server and appears on the **Fleet** page with an **Online** status. You can now deploy pipelines to this node.

If the agent does not appear, check its logs for enrollment errors (`docker compose logs -f` or `journalctl -u vf-agent -f`).
{% endstep %}
{% endstepper %}

## Deployment methods

{% tabs %}
{% tab title="Docker" %}
The simplest approach -- ideal for containerized environments.

```bash
mkdir -p vectorflow-agent && cd vectorflow-agent

curl -sSfL -o docker-compose.yml \
  https://raw.githubusercontent.com/TerrifiedBug/vectorflow/main/docker/agent/docker-compose.yml
```

Create a `.env` file with your server URL and enrollment token:

```bash
cat > .env << 'EOF'
VF_URL=https://your-vectorflow-server:3000
VF_TOKEN=paste-enrollment-token-here
EOF
```

Start the agent:

```bash
docker compose up -d
```

The Docker image bundles Vector, so no additional dependencies are needed. Two named volumes persist agent state and Vector data across restarts:

| Volume | Mount point | Contents |
|--------|-------------|----------|
| `vectorflow-agent-data` | `/var/lib/vf-agent` | Node token, pipeline configs |
| `vectorflow-vector-data` | `/var/lib/vector` | Vector checkpoints and buffer data |

The agent container uses `network_mode: host` so Vector can bind to local ports (e.g., for syslog or socket sources).

{% hint style="warning" %}
After the first successful enrollment, the agent persists a node token to disk. The `VF_TOKEN` enrollment token is no longer needed. You can remove it from your `.env` file, but leaving it has no effect.
{% endhint %}
{% endtab %}

{% tab title="Install script" %}
The install script downloads the agent binary, installs Vector if needed, and configures a systemd service -- all in one command.

```bash
curl -sSfL https://raw.githubusercontent.com/TerrifiedBug/vectorflow/main/agent/install.sh | \
  sudo bash -s -- --url https://vectorflow.example.com --token <enrollment-token>
```

**Managing the service:**

```bash
systemctl status vf-agent          # Check status
journalctl -u vf-agent -f          # Follow logs
sudo systemctl restart vf-agent    # Restart
```

**Upgrading:**

```bash
# Upgrade to the latest release
curl -sSfL https://raw.githubusercontent.com/TerrifiedBug/vectorflow/main/agent/install.sh | sudo bash

# Install a specific version
curl -sSfL https://raw.githubusercontent.com/TerrifiedBug/vectorflow/main/agent/install.sh | \
  sudo bash -s -- --version v0.3.0
```

Existing configuration at `/etc/vectorflow/agent.env` is preserved during upgrades.

**Uninstalling:**

```bash
sudo systemctl stop vf-agent
sudo systemctl disable vf-agent
sudo rm /etc/systemd/system/vf-agent.service
sudo systemctl daemon-reload
sudo rm /usr/local/bin/vf-agent
sudo rm -rf /var/lib/vf-agent /etc/vectorflow
```
{% endtab %}

{% tab title="Standalone binary" %}
Download the binary from the [Releases](https://github.com/TerrifiedBug/vectorflow/releases) page and run it directly. Useful for testing or environments without systemd.

```bash
# Download the latest release for your platform
curl -sSfL -o vf-agent \
  https://github.com/TerrifiedBug/vectorflow/releases/latest/download/vf-agent-linux-amd64
chmod +x vf-agent
```

Run with environment variables:

```bash
VF_URL=https://your-vectorflow-server:3000 \
VF_TOKEN=paste-enrollment-token-here \
./vf-agent
```

Or with a manual systemd unit:

```ini
# /etc/systemd/system/vf-agent.service
[Unit]
Description=VectorFlow Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/vectorflow/agent.env
ExecStart=/usr/local/bin/vf-agent
Restart=on-failure
RestartSec=5

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/vf-agent

[Install]
WantedBy=multi-user.target
```

Make sure Vector is installed and available in `PATH`, or set the `VF_VECTOR_BIN` variable to point to the binary.
{% endtab %}
{% endtabs %}

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VF_URL` | Yes | -- | VectorFlow server URL (e.g., `https://vectorflow.example.com:3000`) |
| `VF_TOKEN` | First run | -- | One-time enrollment token from the UI. Not needed after successful enrollment. |
| `VF_DATA_DIR` | No | `/var/lib/vf-agent` | Directory for agent state (node token, pipeline configs). Mapped to a Docker volume by default. |
| `VF_VECTOR_BIN` | No | `vector` | Path to the Vector binary. Set automatically in the Docker image. |
| `VF_POLL_INTERVAL` | No | `15s` | How often the agent polls for config changes. Uses Go duration format (`15s`, `1m`, `30s`). |
| `VF_LOG_LEVEL` | No | `info` | Log verbosity: `debug`, `info`, `warn`, or `error`. |

## Troubleshooting

**Agent does not appear in Fleet**

- Verify `VF_URL` is correct and reachable from the agent host
- Check that the enrollment token has not already been used
- Look at agent logs for `enrollment failed` errors

**Agent shows as "Unhealthy"**

- The server marks a node unhealthy after 3 missed heartbeats (default: 45 seconds)
- Check network connectivity between the agent and server
- Verify the agent process is running (`systemctl status vf-agent` or `docker ps`)

**Pipeline not starting on agent**

- Confirm the pipeline is deployed to the correct environment
- Check agent logs for Vector process errors
- Verify Vector is installed and accessible at the path in `VF_VECTOR_BIN`
