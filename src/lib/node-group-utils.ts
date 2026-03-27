/**
 * Returns true if the node's labels match all criteria key-value pairs.
 * Empty criteria {} is a catch-all that matches any node.
 */
export function nodeMatchesGroup(
  nodeLabels: Record<string, string>,
  criteria: Record<string, string>,
): boolean {
  if (Object.keys(criteria).length === 0) return true;
  return Object.entries(criteria).every(([k, v]) => nodeLabels[k] === v);
}
