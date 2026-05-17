/**
 * VectorFlow Cloud — closed-source workspace entrypoint.
 *
 * This file exists to register the workspace; it intentionally exports
 * nothing yet. Concrete services (AWS KMS provider, Stripe webhook
 * handler, signup flow, operator console) land in subsequent §16b
 * cloud-* PRs.
 *
 * License: SEE ../LICENSE-CLOUD.md. NOT AGPL.
 */
export const CLOUD_WORKSPACE_VERSION = "0.0.0";
