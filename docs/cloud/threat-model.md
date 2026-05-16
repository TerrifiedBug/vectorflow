# VectorFlow Cloud — Threat Model

**Version:** 1.0  
**Date:** 2026-05-15  
**Status:** Approved — executing Phase 1

This document is the security design contract for VectorFlow Cloud. Changes to the threat model or any control mapping below require a new version with a PR review from at least two maintainers.

---

## 1. Scope

VectorFlow Cloud is a **control-plane-only** SaaS offering. Customers run their own Vector agents on their own infrastructure. The VectorFlow Cloud service stores:

- Pipeline configurations (YAML graphs)
- Fleet metadata (node hostnames, heartbeat state, pipeline-to-node assignment)
- Bounded metrics rollups and log samples (numbers and capped text, not raw log streams)
- Alert rules, notification channel credentials, and secret references
- Audit logs of control-plane actions

VectorFlow Cloud does **not** store or process raw customer log data, event payloads, or any data that flows through the Vector pipelines themselves. `EventSample` and `PipelineLog` are capped in size and retention.

**Out of scope for this threat model:** the customer's Vector agent fleet, the customer's downstream log destinations, physical security of the customer's infrastructure.

---

## 2. Assets to protect

| Asset | Sensitivity | Location |
|-------|-------------|----------|
| Pipeline configs (YAML) | Medium — operational IP | Postgres, encrypted at rest |
| Secret references (API keys, tokens, certs) | High — credential material | Postgres, AES-256-GCM encrypted with per-org DEK |
| OIDC client secrets | High | Postgres, encrypted |
| AI provider API keys | High | Postgres, encrypted |
| Notification channel tokens (Slack, PagerDuty) | High | Postgres, encrypted |
| Git tokens | High | Postgres, encrypted |
| TOTP secrets | High | Postgres, encrypted |
| Log/metric samples | Medium — may contain PII | Postgres, capped to 24h / 64KB |
| Audit log | Medium — operational record | Postgres + S3 (platform audit) |
| Agent enrollment tokens | High — fleet access | Postgres (bcrypt), per-org scoped |
| Node tokens | High — live agent auth | Postgres (bcrypt) |
| Customer user credentials | High | Postgres (bcrypt), OIDC-delegated |

---

## 3. Adversary list (priority order)

### A1 — Curious/malicious tenant (cross-org data access)

A paying customer actively tries to read another tenant's data via API enumeration, token replay, IDOR (insecure direct object reference), malformed GraphQL/tRPC payloads, or timing attacks.

**Controls:**
- `organizationId` on every tenant row (denormalised, indexed)
- `withTeamAccess` middleware validates org membership on every tRPC call
- Postgres Row-Level Security (RLS) as a hard backstop: even a buggy query returns 0 rows from the wrong org
- No sequential numeric IDs exposed in API — UUIDs throughout
- Token format encodes org slug; hostname also encodes org slug; both must agree

### A2 — Compromised agent token

A customer's enrolled node token is stolen (from disk, config file, or network capture). The attacker replays it.

**Controls:**
- Node tokens are org-scoped: `vf_node_<orgSlug>_<8-hex>_<64-hex>`. Cross-org use fails at hostname routing layer before hitting the DB.
- Token scope is read-config + write-heartbeat/logs/metrics only. Cannot read secrets, modify pipelines, enroll new nodes, or access other nodes' data.
- Per-org hostname (`<slug>.agents.vectorflow.sh`) means a token from org A literally cannot reach org B's backend.
- Token rotation available via API; revocation takes effect immediately.
- mTLS (optional): per-org CA means a leaked token without the client cert is insufficient on paying tiers.

### A3 — Compromised operator (insider threat)

A VectorFlow operator (employee or compromised laptop) tries to read customer secrets, configs, or audit trail.

**Controls:**
- Operators are not users. `isSuperAdmin` is removed from the `User` model.
- Operator auth surface is a separate subdomain, WebAuthn-only, behind VPN/IP allowlist.
- Operator sessions cannot enter the customer-facing app surface.
- By default, operator read access returns `[REDACTED]` for all encrypted fields.
- Decryption requires an active `OrgAccessGrant` — a break-glass record that:
  - Requires the customer's OWNER-role user to approve (or opt-in auto-approve for P0)
  - Emails all OWNER-role users in the org at creation
  - Issues a time-bounded KMS GrantToken (max 60 min, non-renewable)
  - Logs every decryption to both the platform audit log and the customer's audit log
- Operator DB role is read-only by default; PII-masked views for log tables.
- Backups encrypted with a separate operator CMK; restore requires two-person approval.
- Platform audit log is append-only (Postgres rule) and shipped to S3 with Object Lock.

### A4 — Stolen database snapshot

An attacker obtains a Postgres dump (insider, backup vendor breach, leaked snapshot).

**Controls:**
- All sensitive fields encrypted with AES-256-GCM.
- Per-org DEK (data encryption key): each organization has its own randomly-generated 32-byte DEK, KMS-wrapped and stored in `Organization.dataKeyCiphertext`.
- A dump reveals ciphertexts but not the DEKs (those are in KMS, not the DB).
- AAD (Additional Authenticated Data) on every ciphertext binds it to org ID + domain + table + row ID. A ciphertext from org A cannot be decrypted as org B even if both DEKs are somehow known.
- KMS CMK is stored in AWS KMS (or Vault for self-hosted), never in the DB or app code.
- BYOK tier: customer brings their own CMK; they can revoke it to cryptographically erase their data.

### A5 — Compromised IdP / account takeover

An attacker compromises a customer's OIDC IdP or takes over one user's account.

**Controls:**
- OIDC is per-org (not shared). A compromise of org A's IdP doesn't affect org B.
- OWNER role requires a second factor (TOTP or WebAuthn); non-bypassable at the application layer.
- Org-wide session revocation: OWNER can rotate the per-org JWT signing key, immediately invalidating all active sessions for that org.
- Account takeover limited by: session TTL (15 min access + sliding refresh), per-org rate limits, and the fact that the attacker still cannot decrypt secrets without the KMS key.

### A6 — SSRF / egress abuse

An attacker (or a malicious pipeline config) uses the control plane's outbound HTTP capability to probe internal services, exfiltrate data, or attack the cloud metadata service.

**Controls:**
- All outbound HTTP goes through `validateOutboundUrl()` in `src/server/services/url-validation.ts`.
- Cloud-strict mode denies: RFC1918, loopback, link-local, AWS metadata (`169.254.169.254`), IPv6 metadata (`fd00:ec2::254`), and `localhost`.
- DNS rebinding defence: hostname resolved once, IP cached, connection reuses cached IP (no re-resolution between validation and request).
- Redirect following capped to 3 hops; no protocol downgrade; each hop re-validated.
- AI provider URLs constrained to a known list; custom `aiBaseUrl` requires org-admin opt-in.
- Webhook destinations require per-org allowlisting (one-time link click).
- Maximum response body size enforced on all outbound calls.

### A7 — DoS from noisy tenant

One tenant's workload (many agents, high-frequency heartbeats, AI requests) degrades service for other tenants.

**Controls:**
- Per-org token-bucket rate limits in Redis:
  - tRPC: 1000 req/min
  - Agent endpoints: 6000 req/min (heartbeat-heavy)
  - AI: 60 req/min
  - Git sync: 120 req/min
- Plan quotas (hard caps): `maxAgents`, `maxPipelines`, `maxEnvironments`, `maxEventsPerMonth`.
- IP-keyed rate limit as a pre-filter for anonymous/unauthenticated requests.
- `Organization.suspendedAt` allows operator to cut off a bad actor with preserved state.

---

## 4. Trust boundaries

```
┌─────────────────────────────────────────────────────────┐
│  PUBLIC INTERNET                                         │
│                                                          │
│  Customer browser ──────────────────────────────────┐   │
│  Customer agent (vf-agent) ──────────────────────┐  │   │
│                                                   │  │   │
└───────────────────────────────────────────────────┼──┼───┘
                                                    │  │
                    ┌───── TLS ──────────────────────┘  │
                    │                                    │
┌───────────────────▼────────────────────────────────────▼──┐
│  VECTORFLOW CLOUD INGRESS                                   │
│  - Terminates TLS                                          │
│  - Strips raw Host header, injects X-VF-Org-Slug           │
│  - IP rate limiting                                        │
└────────────────────────────────────────────────────────────┘
                    │                    │
         ┌──────────▼──────┐   ┌────────▼────────────┐
         │  TENANT APP     │   │  AGENT API          │
         │  (Next.js/tRPC) │   │  /api/agent/*       │
         │  - Session auth │   │  - Token auth       │
         │  - withTeamAcc. │   │  - Org-scoped       │
         │  - orgProcedure │   │  - RLS active       │
         └────────┬────────┘   └────────┬────────────┘
                  │                     │
         ┌────────▼─────────────────────▼────────────┐
         │  POSTGRES (RLS enabled on all tenant tables) │
         │  SET LOCAL app.org_id = '<orgId>'           │
         └──────────────────────────────────────────────┘
                  │
         ┌────────▼───────────┐
         │  AWS KMS / Vault   │
         │  Per-org CMK       │
         │  CloudTrail logged │
         └────────────────────┘

         ┌────────────────────┐
         │  OPERATOR SURFACE  │  ← separate subdomain,
         │  ops.vectorflow…   │    WebAuthn + VPN only,
         │  PlatformOperator  │    cannot reach tenant app
         └────────────────────┘
```

---

## 5. Data flow diagram — agent heartbeat (annotated)

```
vf-agent on customer infra
  │
  ├── HTTPS POST <orgSlug>.agents.vectorflow.sh/api/agent/heartbeat
  │   Authorization: Bearer vf_node_<orgSlug>_<nodeId>_<secret>
  │
  ▼
Ingress validates TLS client cert (mTLS, paying tiers)
Strips Host header, injects X-VF-Org-Slug: <orgSlug>
  │
  ▼
middleware.ts:
  1. Parse X-VF-Org-Slug → hostSlug
  2. Parse token slug → tokenSlug
  3. Assert hostSlug === tokenSlug (else 401 + alert)
  4. Look up org by slug (single indexed query)
  5. Assert !org.suspendedAt (else 503 + Retry-After)
  6. SET LOCAL app.org_id = org.id (RLS binding)
  │
  ▼
authenticateAgentInOrg(req, org.id):
  1. Hash token secret
  2. Look up VectorNode WHERE organizationId = org.id AND tokenHash = hash
  3. Assert node found and not revoked
  │
  ▼
heartbeat handler:
  - Upsert NodePipelineStatus (organizationId already set)
  - Return pipeline config diffs
  │
  ▼
Response encrypted in transit (TLS), config YAMLs
contain no other org's data (RLS + app checks)
```

---

## 6. Control-to-adversary mapping

| Control | Defeats |
|---------|---------|
| `organizationId` + `withTeamAccess` | A1 |
| Postgres RLS | A1, A3 |
| UUID primary keys | A1 |
| Slug-prefixed tokens + hostname routing | A1, A2 |
| mTLS (paying tiers) | A2 |
| Per-org DEK + KMS | A3, A4 |
| AAD binding ciphertexts to org+row | A4 |
| `OrgAccessGrant` break-glass | A3 |
| Operator-separate auth surface | A3 |
| PII-masked DB views | A3 |
| Append-only platform audit log | A3 |
| S3 Object Lock for audit | A3 |
| Per-org OIDC | A5 |
| OWNER 2FA requirement | A5 |
| Org-wide session revocation | A5 |
| `validateOutboundUrl` + DNS rebind defence | A6 |
| Webhook allowlisting | A6 |
| Per-org Redis rate limits | A7 |
| Plan quotas | A7 |
| `Organization.suspendedAt` | A7 |

---

## 7. Known residual risks

| Risk | Mitigation | Accepted? |
|------|-----------|-----------|
| Side-channel timing on token comparison | Use `crypto.timingSafeEqual` throughout | Yes — already implemented |
| KMS unavailability causes 503 | Cache DEK for 5 min; circuit-breaker on KMS calls | Yes — short window |
| Postgres RLS bypass via `SECURITY DEFINER` functions | Audit all DB functions; no `SECURITY DEFINER` in tenant code paths | Yes — operational control |
| Operator CMK compromise | Separate CMK for each concern; rotate on incident | Yes — KMS key policy + CloudTrail alert |
| Social engineering of customer admin for OrgAccessGrant approval | Documented in customer security guide; out of scope for code controls | Yes — process control |
| Log/metric samples containing PII despite caps | Caps reduce but don't eliminate; customers must configure Vector filters | Accepted with disclosure |
| JWT signing key derivation from org DEK — DEK rotation must also rotate JWTs | Org-wide session revocation handles this; documented in runbook | Yes |

---

## 8. Review cadence

- This document reviewed before each Phase boundary (Phase 1, 2, 3, 4, 5, 6).
- Any control listed as "planned" must be implemented and tested before the corresponding phase ships.
- External pen test to be scheduled before Phase 6 (soft launch).

---

## 9. References

- [`docs/cloud/threat-model.md`] — this document
- [`LICENSE-CLOUD.md`] — open-core boundary
- [`SECURITY.md`] — vulnerability disclosure policy
- [`src/server/services/crypto.ts`] — encryption implementation
- [`src/server/services/url-validation.ts`] — egress controls
- [`src/middleware.ts`] — hostname routing and RLS binding
- [OWASP Top 10 (2021)](https://owasp.org/www-project-top-ten/)
- [STRIDE threat modelling](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats)
