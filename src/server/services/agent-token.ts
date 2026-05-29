import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { DEFAULT_ORG_SLUG } from "@/lib/org-constants";

// ─── Token prefixes ───────────────────────────────────────────────────────────

const ENROLLMENT_PREFIX = "vf_enroll_";
const NODE_PREFIX = "vf_node_";

// ─── Slug grammar ─────────────────────────────────────────────────────────────

/** Valid org slug: lowercase letters/digits/hyphens, 3–31 chars, starts with letter. */
const SLUG_PATTERN = /^[a-z][a-z0-9-]{2,30}$/;

export function isValidOrgSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

// ─── Token identifier constants ───────────────────────────────────────────────

const NODE_TOKEN_IDENTIFIER_BYTES = 8;       // 16 hex chars
const NODE_TOKEN_SECRET_BYTES = 32;          // 64 hex chars
const ENROLLMENT_TOKEN_IDENTIFIER_BYTES = 8; // 16 hex chars
const ENROLLMENT_SECRET_BYTES = 32;          // 64 hex chars

// ─── Legacy patterns (no org slug) ───────────────────────────────────────────

/** Legacy enrollment: vf_enroll_<64hex> */
const LEGACY_ENROLLMENT_PATTERN = /^vf_enroll_([a-f0-9]{64})$/;
/** Legacy node:       vf_node_<16hex>_<64hex> */
const LEGACY_NODE_PATTERN = /^vf_node_([a-f0-9]{16})_([a-f0-9]{64})$/;

// ─── Current patterns (org slug embedded) ────────────────────────────────────

/**
 * Current enrollment: vf_enroll_<slug>_<16hex>_<64hex>
 * The 16-hex identifier is indexed in Environment.enrollmentTokenId for O(1)
 * lookup so enrollment does not bcrypt-compare against every candidate env.
 */
const ENROLLMENT_PATTERN = /^vf_enroll_([a-z][a-z0-9-]{2,30})_([a-f0-9]{16})_([a-f0-9]{64})$/;
/**
 * Slug-prefixed enrollment without an embedded identifier (tokens minted before
 * VF-36). Still accepted; verified via the fan-out fallback in the enroll route.
 */
const ENROLLMENT_PATTERN_NO_ID = /^vf_enroll_([a-z][a-z0-9-]{2,30})_([a-f0-9]{64})$/;
/** Current node:       vf_node_<slug>_<16hex>_<64hex> */
const NODE_PATTERN = /^vf_node_([a-z][a-z0-9-]{2,30})_([a-f0-9]{16})_([a-f0-9]{64})$/;

// ─── Enrollment token ─────────────────────────────────────────────────────────

/**
 * Generate a slug-prefixed enrollment token.
 *
 * Format: `vf_enroll_<orgSlug>_<16hex>_<64hex>`
 *
 * OSS / single-tenant deployments use slug "default". Multi-tenant
 * deployments use the org's slug so the token is tied to the org at
 * generation time. The 16-hex identifier is stored in
 * Environment.enrollmentTokenId so the enroll endpoint can verify a single
 * candidate row instead of bcrypt-comparing against every environment.
 */
export async function generateEnrollmentToken(
  orgSlug: string = DEFAULT_ORG_SLUG,
): Promise<{ token: string; hash: string; hint: string; identifier: string }> {
  if (!isValidOrgSlug(orgSlug)) {
    throw new Error(`Cannot mint enrollment token: invalid org slug "${orgSlug}"`);
  }
  const identifier = randomBytes(ENROLLMENT_TOKEN_IDENTIFIER_BYTES).toString("hex");
  const raw = randomBytes(ENROLLMENT_SECRET_BYTES).toString("hex");
  const token = `${ENROLLMENT_PREFIX}${orgSlug}_${identifier}_${raw}`;
  const hash = await bcrypt.hash(token, 12);
  const hint = `****${token.slice(-4)}`;
  return { token, hash, hint, identifier };
}

/**
 * Verify an enrollment token against a stored bcrypt hash.
 * Accepts both legacy (no slug) and current (slug-prefixed) formats.
 */
export async function verifyEnrollmentToken(
  token: string,
  hash: string,
): Promise<boolean> {
  if (!token.startsWith(ENROLLMENT_PREFIX)) return false;
  return bcrypt.compare(token, hash);
}

/**
 * Extract the stable indexed lookup identifier from an enrollment token.
 *
 * Returns the 16-hex id for current `vf_enroll_<slug>_<id>_<secret>` tokens,
 * or null for legacy / no-id tokens (those fall back to the per-environment
 * scan in the enroll route).
 */
export function getEnrollmentTokenIdentifier(token: string): string | null {
  const match = ENROLLMENT_PATTERN.exec(token);
  return match?.[2] ?? null; // group 2 = identifier
}

/**
 * Parse the org slug from an enrollment token.
 * Returns null for legacy tokens (no slug embedded).
 */
export function parseEnrollmentTokenSlug(token: string): string | null {
  const withId = ENROLLMENT_PATTERN.exec(token);
  if (withId) return withId[1];
  const noId = ENROLLMENT_PATTERN_NO_ID.exec(token);
  return noId?.[1] ?? null;
}

/**
 * Return true if this is a legacy enrollment token (pre-slug format).
 */
export function isLegacyEnrollmentToken(token: string): boolean {
  return LEGACY_ENROLLMENT_PATTERN.test(token);
}

// ─── Node token ───────────────────────────────────────────────────────────────

/**
 * Generate a slug-prefixed node token issued to an enrolled agent.
 *
 * Format: `vf_node_<orgSlug>_<16hex>_<64hex>`
 *
 * The 16-hex identifier is indexed in VectorNode.nodeTokenId for O(1) lookup.
 */
export async function generateNodeToken(
  orgSlug: string = DEFAULT_ORG_SLUG,
): Promise<{ token: string; hash: string; identifier: string }> {
  if (!isValidOrgSlug(orgSlug)) {
    throw new Error(`Cannot mint node token: invalid org slug "${orgSlug}"`);
  }
  const identifier = randomBytes(NODE_TOKEN_IDENTIFIER_BYTES).toString("hex");
  const secret = randomBytes(NODE_TOKEN_SECRET_BYTES).toString("hex");
  const token = `${NODE_PREFIX}${orgSlug}_${identifier}_${secret}`;
  const hash = await bcrypt.hash(token, 12);
  return { token, hash, identifier };
}

/**
 * Verify a node token against a stored bcrypt hash.
 * Accepts both legacy (no slug) and current (slug-prefixed) formats.
 */
export async function verifyNodeToken(
  token: string,
  hash: string,
): Promise<boolean> {
  if (!token.startsWith(NODE_PREFIX)) return false;
  return bcrypt.compare(token, hash);
}

/**
 * Extract the stable indexed lookup identifier from a node token.
 *
 * Works for both legacy (`vf_node_<id>_<secret>`) and current
 * (`vf_node_<slug>_<id>_<secret>`) formats.
 *
 * Returns null only for tokens that don't match either format — those fail
 * closed (no fallback fleet scan).
 */
export function getNodeTokenIdentifier(token: string): string | null {
  // Current format: vf_node_<slug>_<16hex>_<64hex>
  const current = NODE_PATTERN.exec(token);
  if (current) return current[2]; // group 2 = identifier

  // Legacy format: vf_node_<16hex>_<64hex>
  const legacy = LEGACY_NODE_PATTERN.exec(token);
  if (legacy) return legacy[1]; // group 1 = identifier

  return null;
}

/**
 * Parse the org slug from a node token.
 * Returns null for legacy tokens (no slug embedded).
 */
export function parseNodeTokenSlug(token: string): string | null {
  const match = NODE_PATTERN.exec(token);
  return match?.[1] ?? null;
}

/**
 * Return true if this is a legacy node token (pre-slug format).
 */
export function isLegacyNodeToken(token: string): boolean {
  return LEGACY_NODE_PATTERN.test(token) && !NODE_PATTERN.test(token);
}

/**
 * Parse an org slug from any agent token (enrollment or node).
 * Returns null for legacy tokens with no embedded slug.
 */
export function parseTokenSlug(token: string): string | null {
  return parseEnrollmentTokenSlug(token) ?? parseNodeTokenSlug(token);
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Extract a Bearer token from an Authorization header value.
 * Returns null if the header is missing or malformed.
 */
export function extractBearerToken(
  authHeader: string | null | undefined,
): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}
