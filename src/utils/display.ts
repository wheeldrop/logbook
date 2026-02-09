/**
 * Heuristic filter for choosing a display-worthy message.
 *
 * When parsers extract the first user message for the `display` field
 * of a SearchableDocument or SessionSummary, some messages are system
 * noise (tool-use interruptions, XML preambles, bare slash-commands).
 * This helper identifies those so the caller can skip to a better one.
 */

const NON_DISPLAYABLE_PREFIXES = [
  "[request interrupted",
  "<local-command-caveat",
  "/resume",
];

/**
 * Returns `true` if `text` looks like a real user prompt suitable for
 * display — i.e. it's not a system/internal message and has enough
 * substance to be useful at a glance.
 */
export function isDisplayableMessage(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 5) return false;

  const lower = trimmed.toLowerCase();
  for (const prefix of NON_DISPLAYABLE_PREFIXES) {
    if (lower.startsWith(prefix)) return false;
  }

  return true;
}
