# SCIM Provisioning

VectorFlow supports SCIM 2.0 (System for Cross-domain Identity Management) for automated user provisioning and deprovisioning from your identity provider. When SCIM is enabled, your IdP can automatically create, update, and deactivate user accounts in VectorFlow.

## Overview

SCIM provisioning automates the user lifecycle:

| Action | What happens in VectorFlow |
|--------|---------------------------|
| **Create user** | A new VectorFlow user account is created with a random password (SSO users authenticate via their IdP, not local credentials) |
| **Update user** | User attributes (name, email) are updated |
| **Deactivate user** | The user account is locked, preventing login |
| **Delete user** | The user account is locked (not deleted, to preserve audit history) |

SCIM Groups are mapped to VectorFlow Teams. When your IdP pushes group membership changes, users are added to or removed from teams.

## Setup

{% stepper %}
{% step %}
### Enable SCIM in VectorFlow

Navigate to **Settings > SCIM** (Super Admin required). Toggle **Enable SCIM** on.
{% endstep %}
{% step %}
### Generate a bearer token

Click **Generate Token**. A bearer token is displayed once -- copy it and store it securely. This token authenticates your IdP's SCIM requests to VectorFlow.

{% hint style="warning" %}
The token is shown only once. If you lose it, generate a new one. The previous token is immediately invalidated.
{% endhint %}
{% endstep %}
{% step %}
### Copy the SCIM base URL

The SCIM base URL is displayed on the settings page:

```
https://your-vectorflow-url/api/scim/v2
```
{% endstep %}
{% step %}
### Configure your identity provider

Enter the SCIM base URL and bearer token into your IdP's SCIM provisioning settings. See the IdP-specific instructions below.
{% endstep %}
{% step %}
### Test and assign

Test the SCIM connection from your IdP, then assign users and groups to the VectorFlow application in your IdP.
{% endstep %}
{% endstepper %}

## IdP-specific instructions

{% tabs %}
{% tab title="Okta" %}
1. In your Okta admin console, open the VectorFlow application (or create a new SAML/OIDC app)
2. Go to the **Provisioning** tab and click **Configure API Integration**
3. Check **Enable API Integration**
4. Set **SCIM connector base URL** to your VectorFlow SCIM URL (e.g., `https://vectorflow.example.com/api/scim/v2`)
5. Set **API Token** to the bearer token generated in VectorFlow
6. Click **Test API Credentials** to verify the connection
7. Save the integration
8. Under **Provisioning > To App**, enable:
   - Create Users
   - Update User Attributes
   - Deactivate Users
9. Go to the **Assignments** tab and assign users or groups
{% endtab %}
{% tab title="Entra ID (Azure AD)" %}
1. In the Azure portal, navigate to **Enterprise Applications** and select your VectorFlow application
2. Go to **Provisioning** and set the mode to **Automatic**
3. Under **Admin Credentials**:
   - **Tenant URL**: Your VectorFlow SCIM URL (e.g., `https://vectorflow.example.com/api/scim/v2`)
   - **Secret Token**: The bearer token generated in VectorFlow
4. Click **Test Connection** to verify
5. Configure **Attribute Mappings** as needed (the defaults usually work)
6. Set **Provisioning Status** to **On**
7. Save and assign users/groups to the application
{% endtab %}
{% tab title="OneLogin" %}
1. In the OneLogin admin console, open your VectorFlow application
2. Go to **Configuration**
3. Set **SCIM Base URL** to your VectorFlow SCIM URL
4. Set **SCIM Bearer Token** to the token generated in VectorFlow
5. Under **Provisioning**, enable the desired actions
6. Assign users via the **Users** tab
{% endtab %}
{% tab title="Other IdPs" %}
Any SCIM 2.0 compatible identity provider can integrate with VectorFlow. Configure:

- **Base URL**: `https://your-vectorflow-url/api/scim/v2`
- **Authentication**: Bearer token (HTTP header)
- **Supported resources**: Users, Groups
{% endtab %}
{% endtabs %}

## Supported endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/scim/v2/Users` | List users (supports `filter`, `startIndex`, `count`) |
| `POST` | `/api/scim/v2/Users` | Create a user |
| `GET` | `/api/scim/v2/Users/:id` | Get a user |
| `PUT` | `/api/scim/v2/Users/:id` | Replace a user |
| `PATCH` | `/api/scim/v2/Users/:id` | Partial update (commonly used for deactivation) |
| `DELETE` | `/api/scim/v2/Users/:id` | Deactivate a user (locks the account) |
| `GET` | `/api/scim/v2/Groups` | List groups (maps to VectorFlow teams) |
| `GET` | `/api/scim/v2/Groups/:id` | Get a group |
| `PATCH` | `/api/scim/v2/Groups/:id` | Update group membership |
| `PUT` | `/api/scim/v2/Groups/:id` | Replace group |

### Filtering

The Users endpoint supports basic SCIM filtering:

```
GET /api/scim/v2/Users?filter=userName eq "john@example.com"
GET /api/scim/v2/Users?filter=externalId eq "abc123"
```

The Groups endpoint supports:

```
GET /api/scim/v2/Groups?filter=displayName eq "Platform Team"
```

## Security

- The SCIM bearer token is encrypted with AES-256-GCM before storage (same encryption used for OIDC client secrets)
- The token is shown only once when generated; VectorFlow does not store the plaintext
- SCIM endpoints require a valid bearer token on every request
- Disabling SCIM clears the stored token
- All SCIM operations are recorded in the audit log

{% hint style="info" %}
SCIM provisioning works best alongside OIDC/SSO. Users created via SCIM receive a random password and should authenticate through your identity provider, not with local credentials.
{% endhint %}

## Troubleshooting

| Issue | Solution |
|-------|----------|
| IdP test connection fails | Verify the SCIM base URL is reachable from your IdP. Check that the bearer token is correct and SCIM is enabled in VectorFlow settings. |
| Users not being created | Check that "Create Users" is enabled in your IdP's provisioning settings. Review the IdP provisioning logs for error details. |
| Users not being deactivated | Check that "Deactivate Users" is enabled in your IdP. VectorFlow locks the account (sets `lockedAt`) rather than deleting it. |
| Group membership not syncing | SCIM Groups map to VectorFlow Teams. Ensure the groups are assigned to the VectorFlow application in your IdP. New members are added with the Viewer role by default. |
| Token expired/invalid | Generate a new token from **Settings > SCIM** and update it in your IdP. The previous token is invalidated immediately. |
