# VectorFlow Cloud — License Boundary

VectorFlow is **open-core software**.

## This repository (OSS)

Everything in this repository is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0). See [`LICENSE`](./LICENSE) for the full text.

You may self-host, fork, modify, and redistribute the code in this repository, subject to the AGPL-3.0 terms: most importantly, if you operate a modified version over a network, you must make the source available to users of that network service.

The OSS edition includes:

- The full Next.js control-plane application
- All tRPC routers, services, and API routes
- The schema primitives for multi-tenancy (`Organization`, `OrgMember`, `OrganizationSettings`) — self-hosted defaults to a single org
- The Vault-backed KMS provider interface and implementation
- The Go `vf-agent` binary
- All Helm charts, Terraform modules under `examples/`, and the Docker Compose setup

## VectorFlow Cloud (closed)

The hosted SaaS product (VectorFlow Cloud) is built on top of this OSS core. The closed-source additions live in a **separate private repository** (`vectorflow-cloud`) and are **not** part of this repository.

Closed additions include:

- AWS KMS provider implementation
- Stripe billing integration and metering
- Signup flow, email verification, and slug reservation
- Platform Operator console (break-glass, org suspension, support tooling)
- Multi-region routing and `OrgDirectory` edge table
- Infrastructure-as-code for the production VectorFlow Cloud stamps

No closed-source code is imported by, vendored into, or referenced from this public repository. The `cloud/` namespace is reserved but empty in the OSS build.

## Why this model

We believe self-hosted infrastructure tooling should remain permanently open. You own your pipelines, your secrets, and your agent fleet — we won't change that.

The closed additions are purely operational concerns for running a managed service at scale (billing, multi-tenancy ops tooling, cloud-specific KMS). None of them are required to run VectorFlow on your own infrastructure.

## Contributor License Agreement

Outside contributions to **this repository** require signing the [VectorFlow CLA](./CLA.md). This grants us an additional right to include your work in the closed-source Cloud build while keeping the OSS edition under AGPL-3.0.

If you do not want to grant that additional right, you may still fork and modify the OSS code under AGPL-3.0 terms — you just cannot have your changes merged upstream.

## Questions

Security issues: [security@vectorflow.sh](mailto:security@vectorflow.sh) or GitHub private vulnerability reporting.  
Licensing questions: [legal@vectorflow.sh](mailto:legal@vectorflow.sh)
