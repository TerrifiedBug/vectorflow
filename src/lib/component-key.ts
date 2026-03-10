import { customAlphabet } from "nanoid";

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const nanoid = customAlphabet(alphabet, 8);

/**
 * Generate an immutable component key: {componentType}_{nanoid(8)}
 * Examples: http_server_k7xMp2nQ, remap_vT3bL9wR
 */
export function generateComponentKey(componentType: string): string {
  return `${componentType}_${nanoid()}`;
}
