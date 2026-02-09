#!/usr/bin/env bash
# WheelDrop Logbook installer — auto-detects and configures for all AI coding agents
# Usage: curl -fsSL https://raw.githubusercontent.com/wheeldrop/logbook/main/install.sh | bash
set -euo pipefail

PACKAGE="@wheeldrop/logbook"
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✘${NC} $*"; }
header(){ echo -e "\n${BOLD}$*${NC}"; }

installed_agents=()
skipped_agents=()

# ── Step 1: Install the npm package globally ──────────────────────────
header "Installing WheelDrop Logbook..."

if ! command -v node &>/dev/null; then
  err "Node.js is required but not found. Install it from https://nodejs.org"
  exit 1
fi

if ! command -v npm &>/dev/null; then
  err "npm is required but not found. Install Node.js from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  err "Node.js 20+ is required (found v$(node -v))"
  exit 1
fi

npm install -g "$PACKAGE" 2>&1 | sed 's/^/  /'
LOGBOOK_BIN=$(npm root -g)/@wheeldrop/logbook/build/index.js

if [ ! -f "$LOGBOOK_BIN" ]; then
  err "Installation failed — could not find $LOGBOOK_BIN"
  exit 1
fi

ok "Installed WheelDrop Logbook globally"
info "Server binary: $LOGBOOK_BIN"

# ── Step 2: Detect and configure agents ──────────────────────────────

# --- Claude Code ---
header "Configuring Claude Code..."

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ -d "$CLAUDE_DIR" ]; then
  if command -v claude &>/dev/null; then
    claude mcp add logbook --scope user -e -- node "$LOGBOOK_BIN" 2>/dev/null && {
      ok "Added Logbook MCP server to Claude Code (user scope)"
      installed_agents+=("Claude Code")
    } || {
      # Fallback: edit ~/.claude.json directly
      CLAUDE_JSON="$HOME/.claude.json"
      if [ -f "$CLAUDE_JSON" ]; then
        if grep -q '"logbook"' "$CLAUDE_JSON" 2>/dev/null; then
          ok "Claude Code already configured (found in $CLAUDE_JSON)"
          installed_agents+=("Claude Code")
        else
          # Inject into existing mcpServers object
          TEMP=$(mktemp)
          node -e "
            const fs = require('fs');
            const cfg = JSON.parse(fs.readFileSync('$CLAUDE_JSON', 'utf8'));
            if (!cfg.mcpServers) cfg.mcpServers = {};
            cfg.mcpServers['logbook'] = { command: 'node', args: ['$LOGBOOK_BIN'] };
            fs.writeFileSync('$TEMP', JSON.stringify(cfg, null, 2));
          " && mv "$TEMP" "$CLAUDE_JSON"
          ok "Added Logbook to $CLAUDE_JSON"
          installed_agents+=("Claude Code")
        fi
      else
        echo '{"mcpServers":{"logbook":{"command":"node","args":["'"$LOGBOOK_BIN"'"]}}}' \
          | node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')),null,2))" \
          > "$CLAUDE_JSON"
        ok "Created $CLAUDE_JSON with Logbook"
        installed_agents+=("Claude Code")
      fi
    }
  else
    warn "Claude Code CLI not found in PATH — skipping"
    info "To configure manually, add to ~/.claude.json:"
    info '  {"mcpServers":{"logbook":{"command":"node","args":["'"$LOGBOOK_BIN"'"]}}}'
    skipped_agents+=("Claude Code (CLI not found)")
  fi
else
  info "Claude Code not detected (~/.claude/ not found) — skipping"
  skipped_agents+=("Claude Code (not installed)")
fi

# --- Codex CLI ---
header "Configuring Codex CLI..."

CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
if [ -d "$CODEX_DIR" ]; then
  CODEX_CONFIG="$CODEX_DIR/config.toml"

  # Add MCP server config
  if [ -f "$CODEX_CONFIG" ] && grep -q '\[mcp_servers\.logbook\]' "$CODEX_CONFIG" 2>/dev/null; then
    ok "Codex MCP server already configured in $CODEX_CONFIG"
  else
    {
      echo ""
      echo "[mcp_servers.logbook]"
      echo "command = \"node\""
      echo "args = [\"$LOGBOOK_BIN\"]"
    } >> "$CODEX_CONFIG"
    ok "Added Logbook MCP server to $CODEX_CONFIG"
  fi

  # Install skill
  CODEX_SKILL_DIR="$CODEX_DIR/skills/logbook-search"
  SKILL_SOURCE=$(npm root -g)/$PACKAGE/skills/logbook-search/SKILL.md
  if [ -f "$SKILL_SOURCE" ]; then
    mkdir -p "$CODEX_SKILL_DIR"
    cp "$SKILL_SOURCE" "$CODEX_SKILL_DIR/SKILL.md"
    ok "Installed logbook-search skill to $CODEX_SKILL_DIR"
  else
    warn "Codex skill file not found in package — MCP server configured, skill skipped"
  fi

  installed_agents+=("Codex CLI")
else
  info "Codex CLI not detected (~/.codex/ not found) — skipping"
  skipped_agents+=("Codex CLI (not installed)")
fi

# --- Gemini CLI ---
header "Configuring Gemini CLI..."

GEMINI_PARENT="${GEMINI_CLI_HOME:-$HOME}"
GEMINI_DIR="$GEMINI_PARENT/.gemini"
if [ -d "$GEMINI_DIR" ]; then
  if command -v gemini &>/dev/null; then
    # Try to install as extension from GitHub
    REPO_URL="https://github.com/wheeldrop/logbook"
    gemini extensions install "$REPO_URL" 2>/dev/null && {
      ok "Installed Logbook Gemini CLI extension from GitHub"
      installed_agents+=("Gemini CLI")
    } || {
      warn "Could not install Gemini extension automatically"
      info "Install manually: gemini extensions install $REPO_URL"
      skipped_agents+=("Gemini CLI (auto-install failed)")
    }
  else
    warn "Gemini CLI not found in PATH — skipping"
    info "To configure manually: gemini extensions install https://github.com/wheeldrop/logbook"
    skipped_agents+=("Gemini CLI (CLI not found)")
  fi
else
  info "Gemini CLI not detected (~/.gemini/ not found) — skipping"
  skipped_agents+=("Gemini CLI (not installed)")
fi

# ── Summary ──────────────────────────────────────────────────────────
header "Installation Summary"
echo ""

if [ ${#installed_agents[@]} -gt 0 ]; then
  ok "Configured for: ${installed_agents[*]}"
fi

if [ ${#skipped_agents[@]} -gt 0 ]; then
  warn "Skipped: ${skipped_agents[*]}"
fi

echo ""
info "WheelDrop Logbook provides 5 MCP tools: logbook_search, logbook_sessions,"
info "logbook_read, logbook_memory, logbook_plans"
echo ""
info "Start a new session in any configured agent and try:"
echo "  \"Search my past conversations about authentication\""
echo ""
