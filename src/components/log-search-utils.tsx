import type { ReactNode } from "react";

const MARK_CLASS = "bg-yellow-500/30 text-yellow-200 rounded-sm px-0.5";

/**
 * Highlight the first occurrence of `search` in `text`.
 * Kept for backward compatibility -- prefer highlightAllMatches for new code.
 */
export function highlightMatch(text: string, search: string): ReactNode {
  if (!search) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className={MARK_CLASS}>{text.slice(idx, idx + search.length)}</mark>
      {text.slice(idx + search.length)}
    </>
  );
}

/**
 * Highlight ALL occurrences of `search` in `text` (case-insensitive).
 * Returns plain string when there are no matches.
 */
export function highlightAllMatches(text: string, search: string): ReactNode {
  if (!search) return text;

  const lowerText = text.toLowerCase();
  const lowerSearch = search.toLowerCase();
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let idx = lowerText.indexOf(lowerSearch, lastIndex);

  if (idx === -1) return text;

  let key = 0;
  while (idx !== -1) {
    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx));
    }
    parts.push(
      <mark key={key++} className={MARK_CLASS}>
        {text.slice(idx, idx + search.length)}
      </mark>,
    );
    lastIndex = idx + search.length;
    idx = lowerText.indexOf(lowerSearch, lastIndex);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

/**
 * Count the number of case-insensitive occurrences of `search` in `text`.
 */
export function countMatches(text: string, search: string): number {
  if (!search) return 0;
  const lowerText = text.toLowerCase();
  const lowerSearch = search.toLowerCase();
  let count = 0;
  let idx = lowerText.indexOf(lowerSearch);
  while (idx !== -1) {
    count++;
    idx = lowerText.indexOf(lowerSearch, idx + lowerSearch.length);
  }
  return count;
}
