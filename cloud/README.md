# VectorFlow Cloud workspace

Closed-source SaaS surface for VectorFlow Cloud (plan §15, §16c option (a)).

## License

This workspace is **NOT** AGPL. See [`LICENSE-CLOUD.md`](../LICENSE-CLOUD.md) at
the repo root. The parent OSS repo stays AGPL-3.0; the boundary is enforced by
the `scripts/verify-no-cloud-imports.sh` CI guard which refuses to merge a PR
that imports from `cloud/` into OSS source.

## Scope

Workspace contents (landing across §16b cloud-N PRs):

- `src/services/kms/aws.ts` — AWS KMS provider implementation (§16b cloud-2 /
  D-4 in §16e).
- `src/services/billing/stripe-webhook.ts` — Stripe webhook handler (§16b
  cloud-7 / D-5).
- `src/services/billing/usage-aggregator.ts` — nightly Stripe usage records
  (§16b cloud-8 / D-6).
- `src/services/quota-policy.ts` — `QuotaPolicyProvider` implementation that
  overlays the commercial FREE / PRO / ENTERPRISE schedule per §15a R3.
- `src/services/auth/email-transport.ts` — Resend-backed magic-link mailer
  per §19 vendor decision.
- `src/app/(operator)/...` — operator console (§16b cloud-4 / D-7).
- `src/app/signup/...` — customer signup (§16b cloud-3 / D-3).
- `src/app/(auth)/exchange/...` — 60-second exchange-code flow (§16b
  cloud-5 / D-8).
- `docs/threat-model.md` — Cloud threat model, relocated from OSS per §15a R5.

## Workspace gating

- The `cloud/` workspace is included in `pnpm-workspace.yaml` so local
  development across both packages stays seamless.
- The OSS distribution (npm package, container image) excludes `cloud/` via
  the root `package.json` `files` field and `.dockerignore`.
- A CI guard (`.github/workflows/verify-no-cloud-imports.yml`) fails any PR
  that introduces an import from `cloud/` into OSS source.

## Local development

```sh
pnpm install
pnpm --filter @vectorflow/cloud build   # type-check the cloud workspace
pnpm --filter @vectorflow/cloud test    # vitest run inside cloud/
```

Cloud-specific tests should live under `cloud/src/__tests__/`.

## Adding a new cloud-only file

1. Place the file under `cloud/src/...`.
2. Imports may freely reference `@vectorflow/cloud/*` and any **public** OSS
   service the parent repo exports.
3. Never reverse-import: nothing under `src/` (OSS) may import from
   `cloud/*` — enforced in CI by `scripts/verify-no-cloud-imports.sh`.

The plan calls out the reverse-import boundary explicitly (§16c):
> "AGPL contamination risk if any leaked import crosses the boundary."
The CI guard makes the boundary mechanical instead of social.
