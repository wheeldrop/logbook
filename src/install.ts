import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
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

  if (!commandExists("claude")) {
    warn("Claude Code CLI not found in PATH — skipping");
    info("Install manually: claude plugin marketplace add wheeldrop/logbook");
    info("                  claude plugin install logbook@logbook");
    return false;
  }

  try {
    // Add marketplace and install plugin (bundles MCP server + skill)
    execSync("claude plugin marketplace add wheeldrop/logbook", { stdio: "ignore" });
    ok("Added wheeldrop/logbook marketplace");
  } catch {
    // Marketplace may already exist — continue to install
  }

  try {
    execSync("claude plugin install logbook@logbook --scope user", { stdio: "ignore" });
    ok("Installed Logbook plugin for Claude Code (user scope)");
    return true;
  } catch (e) {
    warn(`Plugin install failed: ${e}`);
    info("Install manually: claude plugin install logbook@logbook");
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
  const skillDir = join(AGENT_PATHS.codex, "skills", "logbook");
  const skillSource = join(dirname(dirname(import.meta.dirname!)), "skills", "logbook", "SKILL.md");
  if (existsSync(skillSource)) {
    mkdirSync(skillDir, { recursive: true });
    copyFileSync(skillSource, join(skillDir, "SKILL.md"));
    ok(`Installed logbook skill to ${skillDir}`);
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
