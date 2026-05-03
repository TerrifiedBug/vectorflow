# Service Account Permission Backfill

Service account permissions are stored as string arrays on each service account.
The shared catalog change does not require a schema migration.

Existing accounts keep their current least-privilege permissions. Do not
automatically add newly grantable permissions such as `metrics.read`,
`deploy-requests.manage`, `node-groups.*`, `environments.read`, or
`migration.*`; those permissions may expose new operational surfaces and should
be granted intentionally by an administrator.

Recommended rollout:

1. Deploy the shared catalog change.
2. Review existing service accounts that need access to newly exposed API
   routes.
3. Rotate or recreate those service accounts with the required permissions.
4. Revoke old keys after dependents have switched to the new key.

If an in-place permission edit flow is added later, use it for step 3 instead
of key rotation, but keep the same explicit administrator review.
