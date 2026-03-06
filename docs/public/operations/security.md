# Security

This page covers VectorFlow's security architecture: how secrets are managed, how data is encrypted, and recommended hardening practices for production deployments.

## Secret management

VectorFlow provides a built-in secret store for each environment. Secrets hold sensitive values -- API keys, database passwords, authentication tokens -- that pipelines need at runtime but should not be stored in plain text in pipeline configurations.

### Creating secrets

Secrets are created on the **environment detail page** under **Secrets & Certificates**. Each secret has a name and a value. Secret names must start with a letter or number and can contain letters, numbers, hyphens, and underscores.

Secrets are scoped to a single environment. The same secret name can hold different values in different environments (e.g., a `DB_PASSWORD` secret with a test value in dev and a production value in prod).

### How secrets are stored

When you create or update a secret, the value is encrypted with **AES-256-GCM** before being written to the database. The plaintext value is never stored. Only the encrypted ciphertext is persisted.

### How secrets are resolved

When a pipeline is deployed, VectorFlow generates the Vector configuration file. During generation, it scans the configuration for **secret references** and replaces them with the actual decrypted values.

Secret references use the syntax:

```
SECRET[secret-name]
```

For example, a Kafka sink node configured with:

```yaml
sasl:
  username: my-user
  password: SECRET[KAFKA_PASSWORD]
```

At deploy time, `SECRET[KAFKA_PASSWORD]` is resolved to the decrypted value of the `KAFKA_PASSWORD` secret in the pipeline's environment.

### Certificate references

TLS certificates work the same way, using the `CERT[name]` syntax. When a pipeline references a certificate, VectorFlow decrypts the certificate data and deploys it as a file on the agent node:

```yaml
tls:
  crt_file: CERT[my-tls-cert]
```

The agent receives the certificate file and writes it to `/var/lib/vf-agent/certs/`.

## Encryption

### At rest

VectorFlow encrypts sensitive data before storing it in PostgreSQL:

| Data | Algorithm | Key derivation |
|------|-----------|---------------|
| Secrets (user-created) | AES-256-GCM | SHA-256 hash of `NEXTAUTH_SECRET` |
| Certificates | AES-256-GCM | SHA-256 hash of `NEXTAUTH_SECRET` |
| OIDC client secret | AES-256-GCM | SHA-256 hash of `NEXTAUTH_SECRET` |
| Sensitive node config fields | AES-256-GCM | SHA-256 hash of `NEXTAUTH_SECRET` |
| User passwords | bcrypt (cost 12) | Built-in salt |
| TOTP secrets | AES-256-GCM | SHA-256 hash of `NEXTAUTH_SECRET` |
| 2FA backup codes | SHA-256 hash | -- |
| Webhook signing | HMAC-SHA256 | Per-webhook secret |

{% hint style="danger" %}
`NEXTAUTH_SECRET` is the master encryption key for all sensitive data. If this value is changed or lost, all encrypted data (secrets, certificates, OIDC config) becomes permanently unrecoverable. Back up this value securely.
{% endhint %}

### Sensitive field auto-encryption

Pipeline node configurations may contain sensitive fields (passwords, API keys, tokens). VectorFlow automatically detects and encrypts these fields when saving a pipeline, based on:

1. Fields marked as `sensitive: true` in the Vector component schema
2. Field names matching patterns like `password`, `secret`, `token`, or `api_key`

These fields are encrypted before database storage and decrypted only when generating the Vector configuration for deployment.

### In transit

- **Browser to server** -- HTTPS (TLS termination via reverse proxy or load balancer)
- **Agent to server** -- HTTPS over the same endpoint. Agents authenticate with a bearer token issued during enrollment.
- **Server to database** -- Configurable via `sslmode` in the `DATABASE_URL` connection string

## Network security

### Agent connections

Agents initiate all connections to the server. The server never connects outbound to agents. This means:

- Agents can run behind firewalls and NATs
- No inbound ports need to be opened on agent nodes
- Only outbound HTTPS (port 443) to the VectorFlow server is required

### Reverse proxy

In production, place VectorFlow behind a reverse proxy (Nginx, Caddy, Traefik) for TLS termination. See [Deploy the Server](../getting-started/deploy-server.md) for example configurations.

### Agent authentication

Each agent authenticates using a **node token** -- a unique bearer token issued during enrollment. The token is stored at `/var/lib/vf-agent/node-token` with file permissions `0600` (readable only by the owner).

Enrollment tokens (used for initial registration) can be regenerated or revoked from the environment detail page.

## Audit logging

Every mutation in VectorFlow is logged to an audit trail. Audit entries include:

- **Who** -- The authenticated user
- **What** -- The action performed and entity affected
- **When** -- Timestamp
- **Where** -- Client IP address
- **Changes** -- A diff of the fields that were modified

Sensitive fields (passwords, tokens, secrets) are automatically redacted in audit log entries.

View the audit log from the **Audit** page in the sidebar.

## Security hardening checklist

Use this checklist to harden your VectorFlow deployment for production:

{% hint style="warning" %}
Complete all items before exposing VectorFlow to untrusted networks.
{% endhint %}

- [ ] **Generate a strong `NEXTAUTH_SECRET`** -- Use `openssl rand -base64 32` to generate a random 32+ character secret. Never use default or weak values.

- [ ] **Generate a strong `POSTGRES_PASSWORD`** -- Use a random, high-entropy password for the database.

- [ ] **Enable TLS/HTTPS** -- Place VectorFlow behind a reverse proxy with TLS termination. All agent communication should use HTTPS.

- [ ] **Enable 2FA for all users** -- Use team-level "Require 2FA" settings to enforce two-factor authentication for all team members.

- [ ] **Use OIDC/SSO** -- Integrate with your organization's identity provider for centralized authentication and MFA.

- [ ] **Restrict network access** -- Limit access to the VectorFlow server to trusted networks. Use firewall rules or network policies.

- [ ] **Enable database TLS** -- Add `sslmode=require` to your `DATABASE_URL` to encrypt the connection between VectorFlow and PostgreSQL.

- [ ] **Regular backups** -- Enable automatic daily backups and verify restores periodically. See [Backup & Restore](backup-restore.md).

- [ ] **Keep software updated** -- Regularly update VectorFlow server and agents to get security patches. See [Upgrading](upgrading.md).

- [ ] **Review audit logs** -- Periodically review the audit log for unexpected actions or unauthorized access attempts.

- [ ] **Lock unused accounts** -- Lock user accounts that are no longer active instead of leaving them accessible.
