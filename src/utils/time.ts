/**
 * Normalize a timestamp from any agent format into a Date.
 *
 * Handles:
 * - Unix milliseconds (Claude Code history: e.g. 1768287342302)
 * - Unix seconds (Codex history: e.g. 1768287561)
 * - ISO 8601 strings (Claude sessions, Codex sessions, Gemini, Antigravity)
 */
export function normalizeTimestamp(input: unknown): Date | null {
  if (typeof input === "number") {
    // Heuristic: timestamps after 2001-09-09 in milliseconds are > 1e12.
    // All Unix-seconds timestamps we'll encounter are < 1e11 (before year 5138).
    if (input > 1e12) return new Date(input);
    return new Date(input * 1000);
  }
  if (typeof input === "string") {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  if (input instanceof Date) {
    return input;
  }
  return null;
}

export function isInDateRange(
  timestamp: Date,
  from?: Date,
  to?: Date,
): boolean {
  if (from && timestamp < from) return false;
  if (to && timestamp > to) return false;
  return true;
}
