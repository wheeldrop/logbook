import type { AgentParser } from "./types.js";
import { ClaudeParser } from "./claude.js";
import { CodexParser } from "./codex.js";
import { GeminiParser } from "./gemini.js";

export async function discoverParsers(): Promise<AgentParser[]> {
  const allParsers: AgentParser[] = [
    new ClaudeParser(),
    new CodexParser(),
    new GeminiParser(),
    // AntigravityParser will be added here once implemented
  ];

  const available: AgentParser[] = [];
  for (const parser of allParsers) {
    if (await parser.isAvailable()) {
      console.error(`Discovered agent: ${parser.displayName} (${parser.basePath})`);
      available.push(parser);
    }
  }

  if (available.length === 0) {
    console.error("Warning: No agent data directories found");
  }

  return available;
}
