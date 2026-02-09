import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { AGENT_PATHS } from "./utils/paths.js";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const NC = "\x1b[0m";

function info(msg: string) { console.error(`${CYAN}i${NC} ${msg}`); }
function ok(msg: string) { console.error(`${GREEN}\u2714${NC} ${msg}`); }
function warn(msg: string) { console.error(`${YELLOW}\u26a0${NC} ${msg}`); }
function err(msg: string) { console.error(`${RED}\u2718${NC} ${msg}`); }
function header(msg: string) { console.error(`\n${BOLD}${msg}${NC}`); }

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function configureClaude(): boolean {
  header("Configuring Claude Code...");

  if (!existsSync(AGENT_PATHS.claude)) {
    info("Claude Code not detected — skipping");
    return false;
  }

  // Try the CLI first
  if (commandExists("claude")) {
    try {
      execSync('claude mcp add logbook --scope user -e -- npx @wheeldrop/logbook', {
        stdio: "ignore",
      });
      ok("Added Logbook MCP server to Claude Code (user scope)");
      return true;
    } catch {
      // Fall through to JSON config
    }
  }

  // Fallback: write ~/.claude.json directly
  const claudeJson = join(homedir(), ".claude.json");
  const entry = { command: "npx", args: ["@wheeldrop/logbook"] };

  try {
    const cfg = JSON.parse(readFileSync(claudeJson, "utf8"));
    if (cfg.mcpServers?.logbook) {
      ok("Claude Code already configured");
      return true;
    }
    if (!cfg.mcpServers) cfg.mcpServers = {};
    cfg.mcpServers.logbook = entry;
    writeFileSync(claudeJson, JSON.stringify(cfg, null, 2) + "\n");
    ok(`Added Logbook to ${claudeJson}`);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      writeFileSync(claudeJson, JSON.stringify({ mcpServers: { logbook: entry } }, null, 2) + "\n");
      ok(`Created ${claudeJson} with Logbook`);
      return true;
    }
    err(`Failed to update ${claudeJson}: ${e}`);
    return false;
  }
}

function configureCodex(): boolean {
  header("Configuring Codex CLI...");

  if (!existsSync(AGENT_PATHS.codex)) {
    info("Codex CLI not detected — skipping");
    return false;
  }

  const configPath = join(AGENT_PATHS.codex, "config.toml");

  // Add MCP server config
  try {
    const content = readFileSync(configPath, "utf8");
    if (content.includes("[mcp_servers.logbook]")) {
      ok("Codex MCP server already configured");
    } else {
      const tomlBlock = '\n[mcp_servers.logbook]\ncommand = "npx"\nargs = ["@wheeldrop/logbook"]\n';
      writeFileSync(configPath, content + tomlBlock);
      ok(`Added Logbook MCP server to ${configPath}`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      const tomlBlock = '[mcp_servers.logbook]\ncommand = "npx"\nargs = ["@wheeldrop/logbook"]\n';
      writeFileSync(configPath, tomlBlock);
      ok(`Created ${configPath} with Logbook`);
    } else {
      err(`Failed to update ${configPath}: ${e}`);
      return false;
    }
  }

  // Install skill file
  const skillDir = join(AGENT_PATHS.codex, "skills", "logbook-search");
  const skillSource = join(dirname(dirname(import.meta.dirname!)), "skills", "logbook-search", "SKILL.md");
  if (existsSync(skillSource)) {
    mkdirSync(skillDir, { recursive: true });
    copyFileSync(skillSource, join(skillDir, "SKILL.md"));
    ok(`Installed logbook-search skill to ${skillDir}`);
  }

  return true;
}

function configureGemini(): boolean {
  header("Configuring Gemini CLI...");

  if (!existsSync(AGENT_PATHS.gemini)) {
    info("Gemini CLI not detected — skipping");
    return false;
  }

  if (commandExists("gemini")) {
    try {
      execSync("gemini extensions install https://github.com/wheeldrop/logbook", {
        stdio: "inherit",
      });
      ok("Installed Logbook as Gemini CLI extension");
      return true;
    } catch {
      warn("Could not install Gemini extension automatically");
      info("Install manually: gemini extensions install https://github.com/wheeldrop/logbook");
      return false;
    }
  }

  warn("Gemini CLI not found in PATH — skipping");
  info("Install manually: gemini extensions install https://github.com/wheeldrop/logbook");
  return false;
}

export async function runInstall(): Promise<void> {
  header("WheelDrop Logbook — Installer");

  const installed: string[] = [];
  const skipped: string[] = [];

  if (configureClaude()) installed.push("Claude Code");
  else skipped.push("Claude Code");

  if (configureCodex()) installed.push("Codex CLI");
  else skipped.push("Codex CLI");

  if (configureGemini()) installed.push("Gemini CLI");
  else skipped.push("Gemini CLI");

  header("Installation Summary");
  console.error("");

  if (installed.length > 0) {
    ok(`Configured for: ${installed.join(", ")}`);
  }

  if (skipped.length > 0) {
    warn(`Skipped: ${skipped.join(", ")}`);
  }

  if (installed.length === 0) {
    err("No agents detected. Install at least one supported agent first.");
    console.error("");
    info("Supported: Claude Code, Codex CLI, Gemini CLI");
    process.exit(1);
  }

  console.error("");
  info("Start a new session in any configured agent and try:");
  console.error('  "Search my past conversations about authentication"');
  console.error("");
}
