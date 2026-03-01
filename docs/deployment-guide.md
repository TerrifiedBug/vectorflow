# VectorFlow Deployment Guide

This guide covers how to deploy Vector pipeline configurations managed by VectorFlow to your infrastructure using GitOps, configuration management (Puppet), and per-pipeline process isolation.

## Architecture Overview

VectorFlow uses a GitOps workflow to deploy Vector configurations:

```
VectorFlow UI ──▶ Git Repository ──▶ Config Management ──▶ Vector Servers
  (build pipeline)   (GitHub/GitLab/Gitea)  (Puppet/Terraform)     (per-pipeline instances)
```

1. **VectorFlow** generates a validated Vector YAML config for each pipeline
2. Each pipeline is committed as a **separate file** to a git repository
3. Your **config management tool** (Puppet, Terraform, Ansible) syncs configs to servers
4. Each config file runs as an **independent Vector process**

## Config File Structure

When you deploy a pipeline from VectorFlow, it produces a file named:

```
vector-<pipeline-name>.yaml
```

For example, a pipeline called "Syslog Ingest" produces `vector-syslog-ingest.yaml`. The git repository looks like:

```
gitops-repo/
├── vector-syslog-ingest.yaml
├── vector-app-logs.yaml
├── vector-metrics-export.yaml
└── vector-security-audit.yaml
```

Each file is a complete, standalone Vector configuration:

```yaml
sources:
  syslog_input:
    type: syslog
    address: "0.0.0.0:514"

transforms:
  parse_logs:
    type: remap
    inputs:
      - syslog_input
    source: |
      .parsed = parse_syslog!(.message)

sinks:
  elasticsearch:
    type: elasticsearch
    inputs:
      - parse_logs
    endpoints:
      - "https://es.example.com:9200"
```

## Per-Pipeline Process Isolation

### Why Separate Processes?

Running each pipeline as its own Vector process provides:

| Benefit | Description |
|---------|-------------|
| **Fault isolation** | A bad config only affects that one pipeline — others keep running |
| **Independent restarts** | Updating one pipeline doesn't restart or disrupt others |
| **Resource isolation** | Use cgroups/systemd limits to prevent one pipeline from starving others |
| **Granular observability** | Per-pipeline metrics, logs, and health checks |
| **Safe rollouts** | Deploy and validate one pipeline at a time |

This matches the pattern of running one Fluentd instance per pipeline, where a broken config file does not cause every pipeline to restart.

### Directory Layout on Vector Servers

```
/etc/vector/
├── pipelines/
│   ├── syslog-ingest/
│   │   └── vector.yaml
│   ├── app-logs/
│   │   └── vector.yaml
│   └── metrics-export/
│       └── vector.yaml
└── common/              # optional shared resources
    └── ca-certs.pem
```

Each pipeline gets its own directory and systemd unit.

### Systemd Unit Template

Create a template unit at `/etc/systemd/system/vector@.service`:

```ini
[Unit]
Description=Vector pipeline %i
After=network-online.target
Wants=network-online.target
Documentation=https://vector.dev/docs/

[Service]
Type=simple
User=vector
Group=vector
ExecStartPre=/usr/bin/vector validate --no-environment /etc/vector/pipelines/%i/vector.yaml
ExecStart=/usr/bin/vector --config /etc/vector/pipelines/%i/vector.yaml
Restart=on-failure
RestartSec=5s

# Resource isolation
MemoryMax=1G
CPUQuota=50%

# Data directory per pipeline
Environment=VECTOR_DATA_DIR=/var/lib/vector/%i

[Install]
WantedBy=multi-user.target
```

Enable and start a pipeline:

```bash
systemctl enable --now vector@syslog-ingest
systemctl enable --now vector@app-logs
```

Check status:

```bash
systemctl status vector@syslog-ingest
journalctl -u vector@syslog-ingest -f
```

## Puppet Deployment

The following Puppet module syncs pipeline configs from your GitOps repo and manages per-pipeline Vector processes.

### Module Structure

```
puppet/
└── modules/
    └── vectorflow/
        ├── manifests/
        │   ├── init.pp
        │   ├── install.pp
        │   ├── pipeline.pp
        │   └── repo_sync.pp
        └── templates/
            └── vector-pipeline.service.epp
```

### `manifests/init.pp` — Main Class

```puppet
# Main class: installs Vector, sets up the pipeline framework,
# and syncs configs from the GitOps repository.
#
# @param gitops_repo   Git repository URL containing Vector pipeline configs
# @param gitops_branch Branch to pull configs from (default: main)
# @param pipelines     Hash of pipeline names to manage
# @param vector_user   System user for Vector processes (default: vector)
# @param config_dir    Base directory for pipeline configs
# @param data_dir      Base directory for Vector data/checkpoints
class vectorflow (
  String            $gitops_repo,
  String            $gitops_branch  = 'main',
  Hash              $pipelines      = {},
  String            $vector_user    = 'vector',
  String            $config_dir     = '/etc/vector/pipelines',
  String            $data_dir       = '/var/lib/vector',
) {
  contain vectorflow::install
  contain vectorflow::repo_sync

  Class['vectorflow::install']
  -> Class['vectorflow::repo_sync']

  # Create a Vector instance for each pipeline
  $pipelines.each |String $name, Hash $opts| {
    vectorflow::pipeline { $name:
      * => $opts,
    }
  }
}
```

### `manifests/install.pp` — Vector Installation

```puppet
# Installs the Vector binary and creates the service user.
class vectorflow::install {
  # Install Vector from the official repository
  # See: https://vector.dev/docs/setup/installation/package-managers/
  package { 'vector':
    ensure => installed,
  }

  user { $vectorflow::vector_user:
    ensure => present,
    system => true,
    shell  => '/usr/sbin/nologin',
    home   => $vectorflow::data_dir,
  }

  file { [$vectorflow::config_dir, $vectorflow::data_dir]:
    ensure => directory,
    owner  => $vectorflow::vector_user,
    group  => $vectorflow::vector_user,
    mode   => '0750',
  }
}
```

### `manifests/repo_sync.pp` — GitOps Sync

```puppet
# Clones/pulls the GitOps repository and distributes configs
# to per-pipeline directories.
class vectorflow::repo_sync {
  $repo_cache = '/var/cache/vectorflow/gitops-repo'

  file { '/var/cache/vectorflow':
    ensure => directory,
    owner  => 'root',
    group  => 'root',
    mode   => '0755',
  }

  vcsrepo { $repo_cache:
    ensure   => latest,
    provider => git,
    source   => $vectorflow::gitops_repo,
    revision => $vectorflow::gitops_branch,
    require  => File['/var/cache/vectorflow'],
  }

  # Distribute each pipeline config from the repo to its directory
  $vectorflow::pipelines.each |String $name, Hash $opts| {
    $source_file = "${repo_cache}/vector-${name}.yaml"
    $dest_dir    = "${vectorflow::config_dir}/${name}"
    $dest_file   = "${dest_dir}/vector.yaml"

    file { $dest_dir:
      ensure => directory,
      owner  => $vectorflow::vector_user,
      group  => $vectorflow::vector_user,
      mode   => '0750',
    }

    file { $dest_file:
      ensure  => file,
      source  => $source_file,
      owner   => $vectorflow::vector_user,
      group   => $vectorflow::vector_user,
      mode    => '0640',
      require => Vcsrepo[$repo_cache],
      # Restart only this pipeline when its config changes
      notify  => Service["vector@${name}"],
    }
  }
}
```

### `manifests/pipeline.pp` — Per-Pipeline Service

```puppet
# Manages a single Vector pipeline as a systemd service.
#
# @param memory_max  Maximum memory for this pipeline (default: 1G)
# @param cpu_quota   CPU quota percentage (default: 50%)
define vectorflow::pipeline (
  String $memory_max = '1G',
  String $cpu_quota  = '50%',
) {
  $pipeline_name = $name
  $data_path     = "${vectorflow::data_dir}/${pipeline_name}"

  # Per-pipeline data directory for checkpoints and buffers
  file { $data_path:
    ensure => directory,
    owner  => $vectorflow::vector_user,
    group  => $vectorflow::vector_user,
    mode   => '0750',
  }

  # Systemd unit from template
  systemd::unit_file { "vector@${pipeline_name}.service":
    content => epp('vectorflow/vector-pipeline.service.epp', {
      'pipeline_name' => $pipeline_name,
      'config_dir'    => $vectorflow::config_dir,
      'data_dir'      => $vectorflow::data_dir,
      'vector_user'   => $vectorflow::vector_user,
      'memory_max'    => $memory_max,
      'cpu_quota'     => $cpu_quota,
    }),
  }

  service { "vector@${pipeline_name}":
    ensure  => running,
    enable  => true,
    require => [
      File["${vectorflow::config_dir}/${pipeline_name}/vector.yaml"],
      File[$data_path],
    ],
  }
}
```

### `templates/vector-pipeline.service.epp` — Systemd Template

```ini
[Unit]
Description=Vector pipeline <%= $pipeline_name %>
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<%= $vector_user %>
Group=<%= $vector_user %>
ExecStartPre=/usr/bin/vector validate --no-environment <%= $config_dir %>/<%= $pipeline_name %>/vector.yaml
ExecStart=/usr/bin/vector --config <%= $config_dir %>/<%= $pipeline_name %>/vector.yaml
Restart=on-failure
RestartSec=5s
Environment=VECTOR_DATA_DIR=<%= $data_dir %>/<%= $pipeline_name %>
MemoryMax=<%= $memory_max %>
CPUQuota=<%= $cpu_quota %>

[Install]
WantedBy=multi-user.target
```

### Hiera Configuration

Define your pipelines in Hiera data:

```yaml
# data/nodes/vector-server-01.yaml
vectorflow::gitops_repo: 'git@github.com:myorg/vector-configs.git'
vectorflow::gitops_branch: 'main'
vectorflow::pipelines:
  syslog-ingest:
    memory_max: '2G'
    cpu_quota: '100%'
  app-logs:
    memory_max: '1G'
    cpu_quota: '50%'
  metrics-export:
    memory_max: '512M'
    cpu_quota: '25%'
  security-audit:
    memory_max: '1G'
    cpu_quota: '50%'
```

Apply to a node:

```puppet
# site.pp
node 'vector-server-01.example.com' {
  include vectorflow
}
```

## Operations

### Adding a New Pipeline

1. Build and deploy the pipeline in the VectorFlow UI
2. VectorFlow commits `vector-<name>.yaml` to the git repo
3. Add the pipeline name to your Hiera data
4. Puppet picks up the config on the next run and starts a new Vector instance

### Updating a Pipeline

1. Edit and redeploy the pipeline in VectorFlow
2. VectorFlow commits the updated YAML to the git repo
3. Puppet detects the file change and restarts **only** that pipeline's service
4. Other pipelines are unaffected

### Removing a Pipeline

1. Undeploy the pipeline in VectorFlow (removes the file from git)
2. Remove the pipeline from your Hiera data
3. Puppet stops the service and cleans up the config

### Health Checks

```bash
# Check all pipeline services
systemctl list-units 'vector@*' --no-pager

# Validate a config without starting Vector
vector validate --no-environment /etc/vector/pipelines/syslog-ingest/vector.yaml

# View metrics for a specific pipeline
curl -s http://localhost:9598/metrics  # default Vector metrics endpoint
```

For per-pipeline metrics endpoints, configure different ports in each pipeline's sink or use the `api` section in the Vector config:

```yaml
api:
  enabled: true
  address: "127.0.0.1:8687"  # unique port per pipeline
```

### Spreading Pipelines Across Nodes

For high-availability, distribute pipelines across your server fleet:

```yaml
# data/nodes/vector-server-01.yaml
vectorflow::pipelines:
  syslog-ingest: {}
  app-logs: {}

# data/nodes/vector-server-02.yaml
vectorflow::pipelines:
  metrics-export: {}
  security-audit: {}
```

## Docker Deployment

The same per-pipeline isolation approach works with Docker containers. Each pipeline runs in its own container, providing even stronger isolation through separate filesystem, network, and PID namespaces.

### Architecture

```
GitOps Repo ──▶ Git Pull (cron/webhook) ──▶ Docker Host
                                              ├── vector-syslog-ingest  (container)
                                              ├── vector-app-logs       (container)
                                              ├── vector-metrics-export (container)
                                              └── vector-security-audit (container)
```

### Directory Layout

```
/opt/vectorflow/
├── configs/                    # cloned from GitOps repo
│   ├── vector-syslog-ingest.yaml
│   ├── vector-app-logs.yaml
│   ├── vector-metrics-export.yaml
│   └── vector-security-audit.yaml
├── data/                       # persistent data per pipeline
│   ├── syslog-ingest/
│   ├── app-logs/
│   ├── metrics-export/
│   └── security-audit/
└── docker-compose.yml
```

### Docker Compose

Define all pipelines in a single `docker-compose.yml`. Each service is an independent container running one pipeline:

```yaml
# docker-compose.yml
x-vector-common: &vector-common
  image: timberio/vector:0.43.1-debian
  restart: unless-stopped
  networks:
    - vector-net

services:
  syslog-ingest:
    <<: *vector-common
    container_name: vector-syslog-ingest
    volumes:
      - ./configs/vector-syslog-ingest.yaml:/etc/vector/vector.yaml:ro
      - ./data/syslog-ingest:/var/lib/vector
    ports:
      - "514:514/udp"    # syslog input
      - "8686:8686"      # Vector API
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "1.0"

  app-logs:
    <<: *vector-common
    container_name: vector-app-logs
    volumes:
      - ./configs/vector-app-logs.yaml:/etc/vector/vector.yaml:ro
      - ./data/app-logs:/var/lib/vector
      - /var/log/apps:/var/log/apps:ro   # host log directory
    ports:
      - "8687:8686"      # Vector API (unique port)
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: "0.5"

  metrics-export:
    <<: *vector-common
    container_name: vector-metrics-export
    volumes:
      - ./configs/vector-metrics-export.yaml:/etc/vector/vector.yaml:ro
      - ./data/metrics-export:/var/lib/vector
    ports:
      - "9160:9160"      # metrics scrape endpoint
      - "8688:8686"      # Vector API (unique port)
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "0.25"

  security-audit:
    <<: *vector-common
    container_name: vector-security-audit
    volumes:
      - ./configs/vector-security-audit.yaml:/etc/vector/vector.yaml:ro
      - ./data/security-audit:/var/lib/vector
      - /var/log/audit:/var/log/audit:ro
    ports:
      - "8689:8686"      # Vector API (unique port)
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: "0.5"

networks:
  vector-net:
    driver: bridge
```

### Key Docker Compose Concepts

**YAML anchors (`x-vector-common`)** eliminate duplication — shared settings like image version, restart policy, and network are defined once and merged into each service with `<<: *vector-common`.

**Each container gets:**
- Its own config file bind-mounted as `/etc/vector/vector.yaml`
- Its own persistent data directory for checkpoints and buffers
- Its own resource limits (memory and CPU)
- A unique host port for the Vector API (for per-pipeline metrics)

### Managing Pipelines

```bash
cd /opt/vectorflow

# Start all pipelines
docker compose up -d

# Restart only one pipeline (after config update)
docker compose up -d syslog-ingest

# Stop one pipeline without affecting others
docker compose stop app-logs

# View logs for a specific pipeline
docker compose logs -f syslog-ingest

# Validate a config before restarting
docker run --rm -v ./configs/vector-syslog-ingest.yaml:/etc/vector/vector.yaml:ro \
  timberio/vector:0.43.1-debian validate --no-environment

# Check resource usage per pipeline
docker stats --no-stream vector-syslog-ingest vector-app-logs
```

### GitOps Sync with Docker

Use a simple sync script triggered by cron or a webhook:

```bash
#!/bin/bash
# /opt/vectorflow/sync.sh
set -euo pipefail

REPO_DIR="/opt/vectorflow/configs"
COMPOSE_DIR="/opt/vectorflow"
BRANCH="main"

# Pull latest configs
cd "$REPO_DIR"
git fetch origin "$BRANCH"

# Check which files changed
CHANGED=$(git diff --name-only HEAD "origin/${BRANCH}" -- '*.yaml')

git merge "origin/${BRANCH}" --ff-only

if [ -z "$CHANGED" ]; then
  echo "No config changes detected"
  exit 0
fi

# Restart only the pipelines whose configs changed
cd "$COMPOSE_DIR"
for file in $CHANGED; do
  # vector-syslog-ingest.yaml → syslog-ingest
  service=$(echo "$file" | sed 's/^vector-//; s/\.yaml$//')
  echo "Config changed: $file → restarting service: $service"

  # Validate before restarting
  docker run --rm -v "${REPO_DIR}/${file}:/etc/vector/vector.yaml:ro" \
    timberio/vector:0.43.1-debian validate --no-environment

  docker compose up -d "$service"
done
```

Set up a cron job or systemd timer:

```bash
# Sync every 2 minutes
*/2 * * * * /opt/vectorflow/sync.sh >> /var/log/vectorflow-sync.log 2>&1
```

Or trigger via a webhook from your git provider for immediate deployment.

### Puppet with Docker

If you prefer Puppet to manage the Docker containers, replace the systemd-based `pipeline.pp` with Docker Compose management:

```puppet
# manifests/docker.pp
class vectorflow::docker (
  String $compose_dir  = '/opt/vectorflow',
  String $vector_image = 'timberio/vector:0.43.1-debian',
) {
  # Ensure Docker and docker-compose are installed
  include docker
  include docker::compose

  # Sync configs from the GitOps repo
  vcsrepo { "${compose_dir}/configs":
    ensure   => latest,
    provider => git,
    source   => $vectorflow::gitops_repo,
    revision => $vectorflow::gitops_branch,
  }

  # Generate docker-compose.yml from Hiera pipeline definitions
  file { "${compose_dir}/docker-compose.yml":
    ensure  => file,
    content => epp('vectorflow/docker-compose.yml.epp', {
      'pipelines'    => $vectorflow::pipelines,
      'vector_image' => $vector_image,
      'compose_dir'  => $compose_dir,
    }),
    notify  => Docker_compose['vectorflow'],
  }

  # Manage the compose stack
  docker_compose { 'vectorflow':
    compose_files => ["${compose_dir}/docker-compose.yml"],
    ensure        => present,
  }
}
```

### Docker vs Systemd: Which to Choose?

| Aspect | Systemd (bare metal) | Docker |
|--------|---------------------|--------|
| **Isolation** | Process-level (cgroups) | Full container (namespaces + cgroups) |
| **Filesystem** | Shared host filesystem | Isolated per container |
| **Network** | Shared host network | Optional network isolation |
| **Resource limits** | `MemoryMax` / `CPUQuota` | `deploy.resources.limits` |
| **Log access** | Mount host paths directly | Bind-mount host log dirs into container |
| **Upgrades** | Package manager | Change image tag, `docker compose up -d` |
| **Overhead** | Minimal | Slightly higher (container runtime) |
| **Existing infra** | Already on the host | Requires Docker/Podman |

**Use systemd** when Vector is on bare-metal servers that already run Fluentd natively and you want minimal change.

**Use Docker** when you want stronger isolation, easier version management, or your infrastructure already runs containerized workloads.

## Alternative: Terraform

If you use Terraform instead of Puppet, the same pattern applies — whether targeting systemd or Docker. Use `local_file` resources to write configs and `null_resource` provisioners (or a dedicated provider) to manage services. The key principles remain:

- One config file per pipeline
- One Vector process (or container) per config
- Restart only the affected process on config change
- Per-process resource limits

## Summary

| Fluentd (current) | Vector — Systemd | Vector — Docker |
|--------------------|-------------------|-----------------|
| One Fluentd process per pipeline | One Vector process per pipeline | One container per pipeline |
| Separate `.conf` files | Separate `.yaml` files | Separate `.yaml` files |
| Puppet manages Fluentd services | Puppet manages `vector@` services | Puppet/script manages Compose services |
| Broken config affects only that pipeline | Broken config affects only that pipeline | Broken config affects only that container |
| Manual config authoring | Visual builder with validation | Visual builder with validation |
| Process-level isolation | Process-level isolation (cgroups) | Full container isolation (namespaces) |
