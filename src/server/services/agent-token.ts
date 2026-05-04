import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

const ENROLLMENT_PREFIX = "vf_enroll_";
const NODE_PREFIX = "vf_node_";
const NODE_TOKEN_IDENTIFIER_BYTES = 8;
const NODE_TOKEN_SECRET_BYTES = 32;
const NODE_TOKEN_PATTERN = /^vf_node_([a-f0-9]{16})_[a-f0-9]{64}$/;

/**
 * Generate a random enrollment token for agent-based environments.
 * Returns the plaintext token, a bcrypt hash for storage, and a hint
 * showing the last 4 characters (for display in the UI).
 */
export async function generateEnrollmentToken(): Promise<{
  token: string;
  hash: string;
  hint: string;
}> {
  const raw = randomBytes(32).toString("hex");
  const token = `${ENROLLMENT_PREFIX}${raw}`;
  const hash = await bcrypt.hash(token, 12);
  const hint = `****${token.slice(-4)}`;
  return { token, hash, hint };
}

/**
 * Verify an enrollment token against a stored bcrypt hash.
 */
export async function verifyEnrollmentToken(
  token: string,
  hash: string,
): Promise<boolean> {
  if (!token.startsWith(ENROLLMENT_PREFIX)) {
    return false;
  }
  return bcrypt.compare(token, hash);
}

/**
 * Generate a random node token issued to an enrolled agent.
 * Returns the plaintext token and a bcrypt hash for storage.
 */
export async function generateNodeToken(): Promise<{
  token: string;
  hash: string;
  identifier: string;
}> {
  const identifier = randomBytes(NODE_TOKEN_IDENTIFIER_BYTES).toString("hex");
  const secret = randomBytes(NODE_TOKEN_SECRET_BYTES).toString("hex");
  const token = `${NODE_PREFIX}${identifier}_${secret}`;
  const hash = await bcrypt.hash(token, 12);
  return { token, hash, identifier };
}

/**
 * Extract the stable indexed lookup identifier from a node token.
 * Legacy tokens intentionally return null so they fail closed instead of
 * falling back to a fleet-wide bcrypt scan.
 */
export function getNodeTokenIdentifier(token: string): string | null {
  const match = NODE_TOKEN_PATTERN.exec(token);
  return match?.[1] ?? null;
}

/**
 * Verify a node token against a stored bcrypt hash.
 */
export async function verifyNodeToken(
  token: string,
  hash: string,
): Promise<boolean> {
  if (!token.startsWith(NODE_PREFIX)) {
    return false;
  }
  return bcrypt.compare(token, hash);
}

/**
 * Extract a Bearer token from an Authorization header value.
 * Returns null if the header is missing or malformed.
 */
export function extractBearerToken(
  authHeader: string | null | undefined,
): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}
