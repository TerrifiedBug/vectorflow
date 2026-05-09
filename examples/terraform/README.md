# VectorFlow Terraform/OpenTofu automation examples

These examples show how platform teams can drive VectorFlow automation with Terraform or OpenTofu using the existing REST API v1 and the local `vf` CLI wrapper.

There is no first-party VectorFlow Terraform provider yet. Do not add a fake `vectorflow` provider block. Treat these examples as API-backed glue you can adapt for your own platform repository.

## Prerequisites

1. Create a VectorFlow service account with the permissions required for the workflow, such as `pipelines.read` and `pipelines.write`.
2. Export the service account connection details before running Terraform/OpenTofu:

```bash
export VECTORFLOW_URL=https://vectorflow.example.com
export VECTORFLOW_TOKEN=vf_...
```

3. Install dependencies in this repository so the CLI is available:

```bash
pnpm install
```

## Examples

- `environments.tf` declares the input variables expected by automation modules and documents the API-token boundary.
- `pipeline-import.tf` imports a checked-in Vector config through `pnpm vf import` and checks deployment state through `pnpm vf deploy-status`.

The workflow is intentionally service-account first: store pipeline config in Git, review changes in PRs, then let automation call REST API v1 with a scoped token.
