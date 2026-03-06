# Architecture

VectorFlow uses a **hub-and-spoke architecture** where a central server manages configuration and state while lightweight agents run on each node to execute Vector pipelines.

## System overview

```
                          ┌─────────────────────────┐
                          │     Browser (React)      │
                          │  Pipeline Editor, Fleet  │
                          │  Dashboard, Settings     │
                          └───────────┬─────────────┘
                                      │ HTTPS
                          ┌───────────▼─────────────┐
                          │   VectorFlow Server      │
                          │   (Next.js + tRPC)       │
                          │                          │
                          │   ┌──────────────────┐   │
                          │   │   PostgreSQL      │   │
                          │   │   (all state)     │   │
                          │   └──────────────────┘   │
                          └───┬──────────┬──────┬───┘
                              │          │      │
                    ┌─────────▼──┐  ┌────▼───┐  ┌▼──────────┐
                    │  Agent A   │  │Agent B │  │  Agent N  │
                    │  (Go)      │  │ (Go)   │  │  (Go)     │
                    │  ┌───────┐ │  │┌─────┐ │  │ ┌───────┐ │
                    │  │Vector │ │  ││Vec. │ │  │ │Vector │ │
                    │  └───────┘ │  │└─────┘ │  │ └───────┘ │
                    └────────────┘  └────────┘  └───────────┘
```

## Components

### Server

The VectorFlow server is a **Next.js** application that provides the web UI, REST API, and all management logic. It is the single source of truth for pipeline definitions, environment configuration, user accounts, and audit history.

Key responsibilities:
- Serve the browser-based pipeline editor and dashboard
- Store pipeline graphs, configurations, and deployment versions
- Generate Vector configuration files (YAML/TOML) from visual pipeline graphs
- Manage user authentication, teams, and role-based access
- Accept agent heartbeats and store fleet metrics
- Evaluate alert rules and fire webhook notifications

### Agent

The VectorFlow **agent** is a lightweight Go binary that runs on each node where you want to execute Vector pipelines. Agents are stateless -- all configuration comes from the server.

Key responsibilities:
- Enroll with the server using a one-time enrollment token
- Poll the server for configuration changes and pending actions
- Start, stop, and reload Vector processes on the local node
- Report metrics, pipeline status, and logs back to the server
- Self-update when a new agent version is available

### Database

VectorFlow uses **PostgreSQL** as its sole data store. All state lives in the database:

- Pipeline definitions and version history
- Environment, team, and user configuration
- Encrypted secrets and certificates
- Agent node registrations and metrics
- Audit log entries
- System settings (OIDC, backup schedule, fleet tuning)

The schema is managed by Prisma ORM, and migrations run automatically on server startup.

### Vector

[Vector](https://vector.dev) is the high-performance data router that does the actual work of collecting, transforming, and shipping observability data. VectorFlow does not replace Vector -- it provides a management layer on top of it.

Each agent manages one or more Vector processes on its node. When a pipeline is deployed, the agent receives a generated Vector configuration file, writes it to disk, and starts or reloads the Vector process.

## Data flow

### Pipeline lifecycle

A pipeline moves through these stages from creation to execution:

```
Editor (browser)
    │  User builds pipeline graph visually
    ▼
Server (tRPC mutation)
    │  Pipeline graph saved to PostgreSQL
    ▼
Deploy preview
    │  Server generates Vector YAML from graph
    │  Resolves secrets and certificates
    │  Validates configuration
    ▼
Deploy to agents
    │  Creates a PipelineVersion snapshot
    │  Sends config to each agent via heartbeat actions
    ▼
Agent receives config
    │  Writes YAML to disk
    │  Starts or reloads Vector process
    ▼
Vector runs pipeline
    │  Data flows from sources → transforms → sinks
    │  Agent reports metrics back via heartbeat
    ▼
Dashboard
    Events processed, errors, throughput visible in UI
```

### Metrics collection

Agents report metrics to the server on every heartbeat cycle (default: every 15 seconds):

- **Node metrics** -- CPU, memory, disk, and network usage
- **Pipeline status** -- Events in/out, errors, bytes processed per component
- **Logs** -- Pipeline log output
- **Event samples** -- Sample events for schema discovery

The server stores these in PostgreSQL and evaluates alert rules against configured thresholds on each heartbeat.

## Agent communication

### Pull-based polling

Agents use a **pull-based** communication model. The agent initiates all connections -- the server never connects to agents. This design was chosen for three reasons:

1. **Security** -- Agents can run behind firewalls and NATs without exposing any ports. Only outbound HTTPS is required.
2. **Simplicity** -- No need for service discovery, message brokers, or persistent connections.
3. **Scalability** -- The server handles agents as stateless HTTP clients. No per-agent connection state to manage.

### Protocol

Agents communicate via three REST endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agent/enroll` | POST | One-time enrollment. Agent sends enrollment token, receives a persistent node token. |
| `/api/agent/heartbeat` | POST | Periodic check-in. Agent sends metrics and status, receives pending actions (deploy, undeploy, update). |
| `/api/agent/config` | POST | Fetch the generated Vector configuration for a specific pipeline. |

### Heartbeat cycle

On each heartbeat, the agent sends:
- Current agent version
- Node resource metrics (CPU, memory, disk)
- Status of each running pipeline (events processed, errors)
- Pipeline logs since last heartbeat

The server responds with any **pending actions**:
- Deploy a new pipeline version
- Undeploy a pipeline
- Self-update to a new agent version

### Enrollment

When an agent starts for the first time, it sends the enrollment token (provided via `VF_TOKEN`) to the server. The server validates the token, registers the node in the target environment, and returns a persistent **node token**. The agent stores this token locally and uses it for all future heartbeat requests.

```
Agent                              Server
  │                                   │
  │── POST /api/agent/enroll ────────▶│
  │   { enrollmentToken }             │
  │                                   │ Validate token
  │                                   │ Create node record
  │◀── { nodeToken, nodeId } ────────│
  │                                   │
  │   (stores node token to disk)     │
  │                                   │
  │── POST /api/agent/heartbeat ────▶│
  │   { nodeToken, metrics, ... }     │
  │◀── { pendingActions: [...] } ────│
  │                                   │
```

## Security model

VectorFlow's architecture is designed with defense in depth:

- **Agent-initiated connections only** -- The server never opens connections to agent nodes. Agents poll the server over HTTPS, so they work behind firewalls without exposing any inbound ports.
- **Encrypted secrets** -- Sensitive values (API keys, passwords, certificates) are encrypted with AES-256-GCM before storage. They are only decrypted at deploy time when generating Vector configuration.
- **Token-based agent auth** -- Each agent has a unique node token issued during enrollment. Tokens are stored with restricted file permissions (`0600`) on the agent host.
- **Role-based access control** -- Users are assigned roles (Viewer, Editor, Admin) per team. Super Admins have platform-wide access.
- **Audit logging** -- Every mutation is logged with the user, IP address, timestamp, and a diff of changed fields.

For a detailed security guide, see [Security](security.md).
