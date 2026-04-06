# Security Audit Report — V-16

**Date:** 2026-04-06
**Scope:** Auth/session handling, secrets management, CORS/CSP, crypto module, Docker config, monitoring/logging, security TODOs

---

## CRITICAL

### 1. Hardcoded API Key in Committed `.env`
**File:** `.env:1`
**Issue:** `CONTEXT7_API_KEY` with a real value is committed to the repository.
**Action:** Rotate immediately. Remove from Git history with `git-filter-repo`.

### 2. Enrollment Token in `docker/agent/.env`
**File:** `docker/agent/.env:5`
**Issue:** `VF_TOKEN` (enrollment token) committed — allows malicious agent enrollment.
**Action:** Rotate immediately. Scrub from Git history.

### 3. NEXTAUTH_SECRET + POSTGRES_PASSWORD in `docker/server/.env`
**File:** `docker/server/.env:1-2`
**Issue:** JWT signing secret and DB password committed. Anyone with repo access can impersonate users and decrypt stored data.
**Action:** Rotate immediately. Scrub from Git history.

---

## HIGH

### 4. `allowDangerousEmailAccountLinking: true` in OIDC Config
**File:** `src/auth.ts:253`
**Issue:** Allows an attacker controlling an OIDC provider to claim existing local email addresses.
**Action:** Set to `false`; require explicit user confirmation for account linking.

### 5. CORS Wildcard Fallback
**File:** `src/app/api/v1/openapi.json/route.ts:8`
**Issue:** If `NEXTAUTH_URL` is unset, `Access-Control-Allow-Origin: *` is returned.
**Action:** Default to `"null"` or a safe value, never `"*"`.

### 6. Content-Disposition Missing RFC 5987 Encoding
**Files:**
- `src/app/api/v1/audit/export/route.ts`
- `src/app/api/v1/analytics/costs/export/route.ts`
- `src/app/api/backups/[filename]/download/route.ts`

**Issue:** Simple `filename=` used without `filename*=UTF-8''` encoding per RFC 5987.
**Action:** Low practical risk (ASCII-only filenames), but update to follow HTTP spec.

---

## MEDIUM

### 7. `next-auth` Beta Version in Production
**File:** `package.json:47`
**Issue:** `"next-auth": "5.0.0-beta.30"` — beta software in production may have undiscovered CVEs.
**Action:** Upgrade to stable when available, or document accepted risk.

### 8. In-Memory Rate Limiter (No Distributed State)
**File:** `src/app/api/v1/_lib/rate-limiter.ts:21`
**Issue:** `Map<string, SlidingWindow>` — limits lost on restart; bypassed with multiple server instances.
**Action:** Use Redis-backed rate limiting for multi-instance deployments.

### 9. User VRL Code Executed via Child Process
**File:** `src/server/routers/vrl.ts:62-66`
**Issue:** User-supplied VRL source written to tmpdir and executed via `execFileAsync`. Mitigated by tmpdir isolation and 5s timeout, but any Vector binary vulnerability is exploitable.
**Action:** Keep `vector` binary updated; consider sandboxing.

---

## LOW

### 10. Missing Content-Security-Policy Header
**File:** `next.config.ts`
**Action:** Add `Content-Security-Policy` header.

### 11. Missing Strict-Transport-Security Header
**File:** `next.config.ts`
**Action:** Add `Strict-Transport-Security: max-age=31536000; includeSubDomains`.

---

## Positive Findings

| Area | Status |
|------|--------|
| Crypto (AES-256-GCM + HKDF-SHA256, domain-separated keys, IV per message) | Excellent |
| Password hashing (bcrypt, factor 12) | Excellent |
| TOTP 2FA with backup codes | Excellent |
| Account lockout (5 failures → 15 min lockout) | Excellent |
| API key hashing (SHA-256, never stored plaintext) | Excellent |
| Log sanitization (CRLF stripping, sensitive key redaction) | Good |
| Input validation (webhook branch/pipeline names, path traversal checks) | Good |
| Prisma parameterized queries (no SQL injection) | Good |
| Docker server image runs as non-root user | Good |

---

## Immediate Action Items

1. **Rotate all committed secrets** — CONTEXT7_API_KEY, VF_TOKEN, NEXTAUTH_SECRET, POSTGRES_PASSWORD
2. **Scrub Git history** — `git-filter-repo --invert-paths --path .env --path docker/server/.env --path docker/agent/.env`
3. **Disable `allowDangerousEmailAccountLinking`** — `src/auth.ts:253`
4. **Fix CORS default** — `src/app/api/v1/openapi.json/route.ts:8`
5. **Add CSP + HSTS headers** — `next.config.ts`
6. **Plan Redis migration for rate limiter** — when scaling beyond single instance
