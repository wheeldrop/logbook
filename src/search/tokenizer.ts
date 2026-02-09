/**
 * Shared tokenizer and string-distance utilities used by both the search
 * engine (MiniSearch indexing / snippet extraction) and the MCP server
 * (logbook_read query matching).  Keeping them in one place guarantees
 * that "search" and "read" always agree on how text is split into words.
 */

/** Regex used to split text into tokens — matches whitespace and common punctuation. */
export const TOKENIZER_RE = /[\s\-_./\\:,;()[\]{}<>'"]+/;

/** Split `text` into lowercase tokens, dropping any token with length ≤ 1. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(TOKENIZER_RE)
    .filter((t) => t.length > 1);
}

/** Classic Levenshtein edit-distance (single-row DP). */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}
