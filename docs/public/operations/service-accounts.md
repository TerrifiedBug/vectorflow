# Service Accounts

Service accounts provide API keys for programmatic access to VectorFlow's REST API. Unlike user sessions (cookie-based), service account keys use Bearer token authentication and are scoped to a single environment with granular permissions.

---

## Overview

| Feature | Details |
|---------|---------|
| Authentication | `Authorization: Bearer vf_live_...` |
| Scope | One environment per service account |
| Permissions | Granular per-resource (read/manage) |
| Key format | `vf_live_<48 hex chars>` |
| Storage | SHA-256 hashed (raw key shown once at creation) |
| Expiration | Optional (30, 60, 90 days, or never) |

{% hint style="warning" %}
API keys are shown **only once** at creation time. If you lose a key, revoke the service account and create a new one.
{% endhint %}

---

## Creating a Service Account

{% stepper %}
{% step %}
### Navigate to Settings
Go to **Settings** and click **Service Accounts & API Keys**.
{% endstep %}

{% step %}
### Click Create Service Account
Fill in the following fields:

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | A descriptive name (e.g., "CI/CD Deployer") |
| Description | No | Optional context about the account's purpose |
| Environment | Yes | The environment this key can access |
| Expiration | No | Auto-expire after 30, 60, or 90 days (default: never) |
| Permissions | Yes | At least one permission must be selected |
{% endstep %}

{% step %}
### Copy Your API Key
After creation, a modal displays the raw API key. **Copy it immediately** -- it cannot be retrieved again.
{% endstep %}
{% endstepper %}

---

## Permissions

Permissions control what the service account can do via the REST API.

| Permission | Description |
|-----------|-------------|
| `pipelines.read` | List and view pipeline details, versions |
| `pipelines.deploy` | Deploy, undeploy, and rollback pipelines |
| `nodes.read` | List and view node details |
| `nodes.manage` | Toggle node maintenance mode |
| `secrets.read` | List secret names (values are never exposed) |
| `secrets.manage` | Create, update, and delete secrets |
| `alerts.read` | List alert rules |
| `alerts.manage` | Create alert rules |
| `audit.read` | Read audit log events |

{% hint style="info" %}
Permissions are enforced per-request. A `403 Forbidden` response indicates the service account lacks the required permission.
{% endhint %}

---

## Managing Service Accounts

### Revoking

Revoking a service account **immediately disables** the API key. The service account record is preserved for audit purposes.

1. Navigate to **Settings > Service Accounts**
2. Click the **ban icon** next to the account
3. Confirm revocation

### Deleting

Deleting permanently removes the service account and its audit trail association.

1. Navigate to **Settings > Service Accounts**
2. Click the **trash icon** next to the account
3. Confirm deletion

{% hint style="danger" %}
Deletion is irreversible. If you only need to disable access temporarily, use **Revoke** instead.
{% endhint %}

---

## Using the API Key

Include the key in the `Authorization` header of your HTTP requests:

```bash
curl -s https://vectorflow.example.com/api/v1/pipelines \
  -H "Authorization: Bearer vf_live_abc123..."
```

All REST API endpoints are under `/api/v1/`. See the [API Reference](../reference/api.md) for the complete endpoint list.

---

## Security Best Practices

- **Least privilege**: Only grant the permissions the service account needs
- **Set expiration**: Use 30-90 day expiration for CI/CD keys and rotate regularly
- **Store securely**: Keep API keys in a secrets manager (not in source code)
- **Monitor usage**: Check the "Last Used" column to detect unused accounts
- **Revoke promptly**: Revoke keys when they are no longer needed or if compromised
- **One per integration**: Create separate service accounts for each CI/CD pipeline or integration

---

## Key Rotation

VectorFlow does not support in-place key rotation. To rotate a key:

{% stepper %}
{% step %}
### Create a new service account
Use the same name (with a version suffix) and permissions.
{% endstep %}

{% step %}
### Update your integration
Replace the old key with the new one in your CI/CD pipeline or integration.
{% endstep %}

{% step %}
### Revoke the old account
Once the new key is confirmed working, revoke the old service account.
{% endstep %}
{% endstepper %}
