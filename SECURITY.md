# Security Policy

## Reporting a Vulnerability

We take the security of VectorFlow seriously. If you discover a security vulnerability in either the OSS edition or VectorFlow Cloud, please report it through GitHub's private vulnerability reporting so we can address it before it becomes public knowledge.

### How to Report

1. Go to the [Security Advisories](https://github.com/TerrifiedBug/vectorflow/security/advisories) page
2. Click "Report a vulnerability"
3. Provide a description of the vulnerability, steps to reproduce, and any potential impact

For critical vulnerabilities in VectorFlow Cloud (the hosted service) that require direct communication, email [security@vectorflow.sh](mailto:security@vectorflow.sh). Use our PGP key (key ID: to be published at `trust.vectorflow.sh`) for sensitive disclosures.

### What to Expect

- **Acknowledgment** within 48 hours of your report
- **Status update** within 7 days with an assessment and expected resolution timeline
- **Credit** in the release notes when the fix is published (unless you prefer to remain anonymous)
- **CVE coordination** for vulnerabilities that warrant a CVE assignment

### Scope

The following are in scope for security reports:

**Authentication and authorization**
- Authentication and authorization bypasses
- Cross-tenant data access (IDOR, RLS bypass, scope confusion)
- Privilege escalation
- Session fixation, JWT forgery, token replay

**Data security**
- Credential or secret exposure (plaintext, logging, API responses)
- Encryption implementation flaws (weak ciphers, IV reuse, AAD bypass)
- Insecure direct object references leaking cross-org data

**Injection**
- SQL injection (including second-order)
- XSS (stored, reflected, DOM-based)
- SSRF (server-side request forgery) against internal services or cloud metadata endpoints
- Command injection

**Agent communication**
- Agent-to-server authentication bypass
- Cross-tenant agent token abuse
- Config poisoning via the agent API

**Infrastructure (VectorFlow Cloud)**
- Vulnerabilities in the ingress layer enabling cross-org routing abuse
- KMS misconfigurations leading to unauthorized decryption
- Break-glass procedure bypass (obtaining `OrgAccessGrant` without customer approval)

### Out of Scope

- Vulnerabilities in third-party dependencies (report these to the upstream project; we will patch promptly when upstream releases a fix)
- Social engineering attacks
- Denial of service attacks requiring significant resources (> 1 Gbps / > 10k req/s sustained)
- Vulnerabilities that require physical access to customer infrastructure
- Issues in customer-operated Vector agents or downstream pipeline destinations
- Rate limit bypasses that don't expose data (report these as bugs, not security issues)
- Missing security headers on non-authenticated public pages (low severity; still appreciated)
- Self-XSS (requires victim to paste attacker payload into their own browser)

### Severity Definitions

| Severity | Examples |
|----------|---------|
| **Critical** | Cross-tenant secret exposure, RLS bypass returning another org's data, authentication bypass on the main app, remote code execution |
| **High** | Privilege escalation within an org, SSRF reaching internal services, agent token scope expansion, break-glass bypass |
| **Medium** | Information disclosure (non-secret data from another org), stored XSS in admin-visible fields, rate limit bypass |
| **Low** | Missing security headers, reflected XSS requiring unusual user interaction, verbose error messages |

### Safe Harbour

We will not pursue legal action against researchers who:

- Report through the process above (or responsibly disclose after 90 days if we are unresponsive)
- Do not exfiltrate, modify, or destroy customer data
- Do not disrupt service availability
- Do not access accounts or data beyond what is necessary to demonstrate the vulnerability

---

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest main | ✅ |
| Previous minor | Security patches only |
| Older | ✗ — upgrade first |

VectorFlow Cloud always runs the latest main. Self-hosted deployments are encouraged to upgrade promptly when security patches ship.

---

## Security Architecture (VectorFlow Cloud)

This section summarises the security controls in the hosted service. The full threat model is maintained as an internal document (`docs/cloud/threat-model.md`).

### Tenant isolation

- Every tenant row carries a denormalised `organizationId` column. All application queries include it.
- Postgres Row-Level Security (RLS) is enabled on every tenant table. Even a buggy query returns zero rows from the wrong org.
- Org slugs are embedded in agent token prefixes and in the agent API hostname (`<slug>.agents.vectorflow.sh`). Both must agree or the request is rejected with a 401 before hitting the database.

### Encryption at rest

- Sensitive fields (secrets, credentials, OIDC config, AI keys, git tokens) are encrypted with AES-256-GCM.
- Each organization has its own 32-byte data encryption key (DEK), KMS-wrapped by a Cloud KMS CMK. A database dump is unreadable without KMS access.
- Additional Authenticated Data (AAD) on every ciphertext binds it to the specific org, domain, table, and row. Cross-tenant ciphertext replay is rejected at decryption time.
- BYOK (bring your own key) is available on Enterprise tier.

### Operator access model

- Platform operators cannot read customer secrets by default. Encrypted fields return `[REDACTED]`.
- Accessing customer data requires an `OrgAccessGrant` — a break-glass record that notifies the customer's OWNER-role users via email, requires their approval, and is time-bounded to 60 minutes.
- All decryptions during a break-glass window are recorded in the customer's own audit log.
- Operator actions are recorded in a separate append-only platform audit log shipped to S3 with Object Lock.

### Egress

- All outbound HTTP from the control plane (webhooks, AI calls, Slack, git sync, SMTP) is validated against an allowlist that denies RFC1918, loopback, link-local, and cloud metadata service IPs.
- DNS rebinding protection: hostname resolved once, IP cached, reused for the actual connection.

---

## Disclosure Policy

We follow a **90-day coordinated disclosure** policy:

1. Reporter submits finding.
2. We acknowledge within 48 hours.
3. We aim to patch Critical and High findings within **14 days**, Medium within **60 days**.
4. We notify the reporter when a patch is ready and agree on a public disclosure date (default: patch ships + 7 days).
5. If we exceed 90 days total without a shipped patch, the reporter may disclose at their discretion.

For findings that are actively exploited in the wild, we will fast-track patches and coordinate disclosure in real time.

---

## Bug Bounty

VectorFlow Cloud does not currently operate a paid bug bounty programme. We recognise and thank reporters in our release notes and, for significant findings, with a free PRO subscription for the duration of the programme's trial phase.

We intend to launch a formal bug bounty (likely via HackerOne) when VectorFlow Cloud exits invite-only and opens to general availability.
