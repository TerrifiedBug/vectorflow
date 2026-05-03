# VectorFlow Helm Charts

Helm charts for deploying VectorFlow on Kubernetes.

| Chart | Description |
|-------|-------------|
| [vectorflow-server](./vectorflow-server/) | Next.js control plane — Deployment, Service, Ingress, PDB |
| [vectorflow-agent](./vectorflow-agent/) | Go agent — DaemonSet (one per node) |

## Prerequisites

- Kubernetes 1.25+
- Helm 3.10+
- An external PostgreSQL instance (or enable the bundled subchart)

## Quick Start

### 1. Add the Bitnami chart repository (required for bundled PostgreSQL / Redis)

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

### 2. Install the server

```bash
# Download subchart dependencies first
helm dependency update charts/vectorflow-server

# Install with an external PostgreSQL database
helm install vectorflow ./charts/vectorflow-server \
  --namespace vectorflow \
  --create-namespace \
  --set nextauthUrl=https://vectorflow.example.com \
  --set secret.nextauthSecret=$(openssl rand -base64 32) \
  --set secret.databaseUrl="postgresql://vectorflow:password@postgres-host:5432/vectorflow"
```

### 3. Install the agent (on each cluster that should run pipelines)

```bash
helm install vectorflow-agent ./charts/vectorflow-agent \
  --namespace vectorflow \
  --set config.serverUrl=http://vectorflow.vectorflow.svc.cluster.local:3000 \
  --set config.token=<enrollment-token-from-ui>
```

## Configuration

### Server Chart

See [vectorflow-server/values.yaml](./vectorflow-server/values.yaml) for all options.

#### Minimal required values

```yaml
nextauthUrl: "https://vectorflow.example.com"
secret:
  nextauthSecret: "<openssl rand -base64 32>"
  databaseUrl: "postgresql://user:password@host:5432/dbname"
```

#### With bundled PostgreSQL (development / testing only)

```yaml
nextauthUrl: "http://localhost:3000"
secret:
  nextauthSecret: "<openssl rand -base64 32>"
  # databaseUrl is auto-configured when postgresql.enabled=true
postgresql:
  enabled: true
  auth:
    password: "changeme"
```

#### High-availability with Redis session store

```yaml
replicaCount: 3
nextauthUrl: "https://vectorflow.example.com"
secret:
  nextauthSecret: "<openssl rand -base64 32>"
  databaseUrl: "postgresql://user:password@host:5432/dbname"
redis:
  enabled: true
podDisruptionBudget:
  enabled: true
  minAvailable: 2
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: DoNotSchedule
persistence:
  data:
    accessMode: ReadWriteMany
  backups:
    enabled: true
    accessMode: ReadWriteMany
```

#### HA coordination contract

VectorFlow treats a server install as HA when `replicaCount > 1` or
`autoscaling.enabled=true` with `autoscaling.maxReplicas > 1`.

Leader election is required for all singleton background work. The server uses
Redis key `vectorflow:leader` with `SET ... NX EX`, renews the lease every 5
seconds, and uses a 15-second TTL. If the leader stops renewing, another replica
can acquire the key and start singleton services. The following work is
leader-only:

| Work | Reason |
|------|--------|
| Legacy backup import | Avoid duplicate filesystem imports |
| Backup scheduler and retention/orphan cleanup | Avoid duplicate backups and cleanup races |
| Telemetry scheduler | Avoid duplicate telemetry sends |
| Notification retry service | Avoid duplicate delivery attempts |
| Auto-rollback monitor | Avoid competing rollback decisions |
| Staged rollout health monitor | Avoid competing rollout state transitions |
| Fleet alert evaluator | Avoid duplicate fleet alert events |
| Git sync retry service | Avoid duplicate retry jobs |
| Cost optimizer scheduler | Avoid duplicate recommendations |
| Anomaly detection job | Avoid duplicate anomaly events |

Redis pub/sub is not leader-only. It runs on every replica because any replica
can hold browser SSE connections. System Vector boot is also per-replica rather
than leader-only.

#### HA storage contract

Multi-replica installs require shared persistent storage for
`/app/.vectorflow`, mounted from `persistence.data`. The chart rejects HA values
that use `emptyDir` or a chart-created `ReadWriteOnce` data PVC. Set
`persistence.data.accessMode=ReadWriteMany`, or provide
`persistence.data.existingClaim` backed by RWX-capable storage.

If backup persistence is enabled in HA, `/backups` must also be shared. Set
`persistence.backups.accessMode=ReadWriteMany`, or provide
`persistence.backups.existingClaim` backed by RWX-capable storage. When backup
persistence is disabled, backups are not durable across pod restarts.

#### HA migrations and readiness

Single-replica installs run `prisma migrate deploy` in the server container
entrypoint by default. HA installs render a Helm pre-install/pre-upgrade Job
named `<release>-vectorflow-server-migrate` and set
`VF_RUN_MIGRATIONS=false` on server pods so migrations are not started once per
replica. The migration Job must complete before Helm rolls the Deployment.

Readiness probes use `/api/health/ready`. The endpoint always checks database
connectivity. In HA, the chart sets `VF_REDIS_REQUIRED=true`, so readiness also
requires Redis to be connected before a pod receives traffic. Liveness remains
process-only at `/api/health/live`.

#### Using an existing Secret

Create a Kubernetes secret containing `NEXTAUTH_SECRET`, `DATABASE_URL`, and optionally `REDIS_URL`:

```bash
kubectl create secret generic vectorflow-secrets \
  --namespace vectorflow \
  --from-literal=NEXTAUTH_SECRET=$(openssl rand -base64 32) \
  --from-literal=DATABASE_URL="postgresql://user:password@host:5432/dbname"
```

Then install with:

```yaml
existingSecret: "vectorflow-secrets"
nextauthUrl: "https://vectorflow.example.com"
```

#### Ingress

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: vectorflow.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: vectorflow-tls
      hosts:
        - vectorflow.example.com
```

### Agent Chart

See [vectorflow-agent/values.yaml](./vectorflow-agent/values.yaml) for all options.

#### Minimal required values

```yaml
config:
  serverUrl: "http://vectorflow.vectorflow.svc.cluster.local:3000"
  token: "<enrollment-token>"
```

#### Node labels and selectors

```yaml
config:
  serverUrl: "http://vectorflow.vectorflow.svc.cluster.local:3000"
  nodeLabels: "region=us-east-1,env=production"

# Only schedule agents on specific nodes
nodeSelector:
  node-type: worker
```

#### Host path volumes (for persistent agent state across pod restarts)

```yaml
persistence:
  agentData:
    hostPath: /var/lib/vf-agent
  vectorData:
    hostPath: /var/lib/vector
```

#### Skip control-plane nodes

Remove the control-plane toleration to prevent agents from scheduling there:

```yaml
tolerations:
  - key: node.kubernetes.io/not-ready
    operator: Exists
    effect: NoExecute
    tolerationSeconds: 10
  - key: node.kubernetes.io/unreachable
    operator: Exists
    effect: NoExecute
    tolerationSeconds: 10
```

## Health Endpoints

The server exposes three health endpoints used by Kubernetes probes:

| Endpoint | Type | Checks |
|----------|------|--------|
| `/api/health/live` | Liveness | Always 200 — process is running |
| `/api/health/ready` | Readiness | Database connectivity |
| `/api/health/startup` | Startup | Used during initial pod startup |

## Database

VectorFlow uses PostgreSQL. For production deployments, use a managed database service (RDS, Cloud SQL, etc.) or a TimescaleDB instance.

The bundled `postgresql` subchart (bitnami/postgresql) is provided for development and testing only. It does **not** include TimescaleDB extensions used by the production Docker Compose stack.

## Upgrading

```bash
helm upgrade vectorflow ./charts/vectorflow-server -f my-values.yaml
helm upgrade vectorflow-agent ./charts/vectorflow-agent -f my-agent-values.yaml
```

## Uninstalling

```bash
helm uninstall vectorflow --namespace vectorflow
helm uninstall vectorflow-agent --namespace vectorflow
```

> **Note:** PersistentVolumeClaims are not deleted by `helm uninstall`. Delete them manually if you want to remove all data.
