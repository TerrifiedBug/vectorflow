import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

const ENROLLMENT_PREFIX = "vf_enroll_";
const NODE_PREFIX = "vf_node_";

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
}> {
  const raw = randomBytes(32).toString("hex");
  const token = `${NODE_PREFIX}${raw}`;
  const hash = await bcrypt.hash(token, 12);
  return { token, hash };
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
