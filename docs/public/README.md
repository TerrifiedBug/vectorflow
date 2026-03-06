# Introduction

VectorFlow is a visual pipeline management platform for [Vector](https://vector.dev), the high-performance observability data pipeline. It gives teams a web-based UI for designing, deploying, and monitoring Vector pipelines across an entire fleet of nodes -- no hand-edited TOML required.

![VectorFlow Dashboard](screenshots/dashboard.png)

## Why VectorFlow?

Observability pipelines are critical infrastructure, yet managing them usually means juggling config files across dozens of servers. VectorFlow replaces that workflow with a centralized control plane:

- **Visual Pipeline Editor** -- Drag-and-drop sources, transforms, and sinks onto a canvas. The editor generates valid Vector configuration automatically.
- **Fleet Management** -- Enroll agents on every node and push pipeline updates from a single dashboard. See which agents are online, what they are running, and roll back instantly.
- **Multi-Environment Support** -- Maintain separate development, staging, and production environments. Promote pipelines through your deployment lifecycle with confidence.
- **VRL Snippet Testing** -- Write and test Vector Remap Language transforms interactively before they reach production.
- **Real-Time Metrics** -- Monitor throughput, error rates, and pipeline health at a glance.
- **Alerting** -- Define alert rules so you know the moment a pipeline degrades.

## Technology

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Flow Editor | React Flow (@xyflow/react) |
| Code Editor | Monaco Editor with VRL syntax |
| API | tRPC (type-safe RPC) |
| Authentication | NextAuth (credentials + OIDC) |
| Database | PostgreSQL, Prisma ORM |
| Agent | Go (zero external dependencies) |
| Data Engine | Vector (vector.dev) |

{% hint style="info" %}
**Get started in 5 minutes.** Follow the [Quick Start](getting-started/quick-start.md) guide to spin up VectorFlow with Docker and build your first pipeline.
{% endhint %}

## Quick Links

| | |
|---|---|
| **Getting Started** | [Quick Start](getting-started/quick-start.md) -- Install and run VectorFlow |
| **Deploy** | [Server](getting-started/deploy-server.md) -- Set up the VectorFlow server |
| | [Agents](getting-started/deploy-agents.md) -- Enroll agents on your nodes |
| **Learn** | [Pipeline Editor](user-guide/pipeline-editor.md) -- Build pipelines visually |
| | [Fleet Management](user-guide/fleet.md) -- Manage your agent fleet |
| **Operate** | [Architecture](operations/architecture.md) -- Understand how it all fits together |
| | [Configuration](operations/configuration.md) -- Environment variables and settings |
| **Reference** | [API](reference/api.md) -- Full API documentation |
| | [Pipeline YAML](reference/pipeline-yaml.md) -- Pipeline configuration format |
