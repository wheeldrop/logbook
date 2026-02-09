import { homedir } from "os";
import { join } from "path";

export function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/**
 * Claude Code encodes project paths by replacing all `/` with `-`.
 * E.g. `/home/testuser/my-project` becomes `-home-testuser-my-project`.
 */
export function encodeClaudePath(projectPath: string): string {
  return projectPath.replace(/\//g, "-");
}

/**
 * Resolve the data directory for each agent, respecting env var overrides.
 *
 * - CLAUDE_CONFIG_DIR → replaces ~/.claude directly
 * - CODEX_HOME        → replaces ~/.codex directly
 * - GEMINI_CLI_HOME   → sets parent dir; .gemini is created inside
 */
function resolveAgentPaths() {
  const home = homedir();

  const claude = process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const codex = process.env.CODEX_HOME || join(home, ".codex");

  // Gemini CLI: GEMINI_CLI_HOME sets the parent directory, .gemini goes inside
  const geminiParent = process.env.GEMINI_CLI_HOME || home;
  const gemini = join(geminiParent, ".gemini");

  return {
    claude,
    codex,
    gemini,
    antigravity: join(gemini, "antigravity"),
  };
}

export const AGENT_PATHS = resolveAgentPaths();
