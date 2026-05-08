export function getMigrationTranslationBlocks(value: unknown): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== "object") return [];

  const blocks = (value as { blocks?: unknown }).blocks;
  return Array.isArray(blocks) ? blocks : [];
}
