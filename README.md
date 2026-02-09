# WheelDrop Logbook

The flight recorder for your AI coding agents. An MCP server that gives Claude Code, Codex, and Gemini CLI a shared, persistent memory.

[![CI](https://github.com/wheeldrop/logbook/actions/workflows/ci.yml/badge.svg)](https://github.com/wheeldrop/logbook/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@wheeldrop/logbook.svg)](https://www.npmjs.com/package/@wheeldrop/logbook)
[![codecov](https://codecov.io/gh/wheeldrop/logbook/graph/badge.svg)](https://codecov.io/gh/wheeldrop/logbook)

Your AI coding agents have amnesia. Every session starts from scratch — no memory of what you built yesterday, what patterns you chose, or what mistakes were already solved. WheelDrop Logbook fixes this by indexing your agents' conversation history, memory files, and plans into a searchable MCP server that any agent can query.

## Quick Start

Auto-detect installed agents and configure them all:

```bash
npx @wheeldrop/logbook --install
```

This detects which agents you have (Claude Code, Codex CLI, Gemini CLI), configures each one to use Logbook as an MCP server, and installs agent-specific skills where supported. The installer also copies a skill file to `~/.codex/skills/logbook-search/` so Codex auto-triggers conversation search when relevant.

## Per-Agent Setup

### Claude Code

**Plugin install** (if available):
```bash
claude plugin add @wheeldrop/logbook
```

**MCP server** (manual):
```bash
claude mcp add logbook --scope user -e -- npx @wheeldrop/logbook
```

### Gemini CLI

**Extension install**:
```bash
gemini extensions install https://github.com/wheeldrop/logbook
```

### Codex CLI

Add to `~/.codex/config.toml`:
```toml
[mcp_servers.logbook]
command = "npx"
args = ["@wheeldrop/logbook"]
```

Optionally, copy the bundled skill for auto-triggered search:
```bash
mkdir -p ~/.codex/skills/logbook-search
cp $(npm root -g)/@wheeldrop/logbook/skills/logbook-search/SKILL.md ~/.codex/skills/logbook-search/
```

### Any MCP-Compatible Client

Logbook works with any tool that supports the [Model Context Protocol](https://modelcontextprotocol.io). Add this to your client's MCP server configuration:

```json
{
  "logbook": {
    "command": "npx",
    "args": ["@wheeldrop/logbook"]
  }
}
```

The server uses stdio transport — no network, no API keys, purely local.

### Agent Skills (Optional)

Logbook ships a skill file (`skills/logbook-search/SKILL.md`) that teaches agents how to search effectively — query formulation, result triage, the search→sessions→read drill-in workflow. Copy it into any agent that supports skills:

- **Codex CLI**: `~/.codex/skills/logbook-search/SKILL.md`
- **Claude Code**: Install as a plugin (bundles the skill automatically)
- **Gemini CLI**: Install as an extension (bundles the skill automatically)

## What It Does

WheelDrop Logbook indexes conversation history, memory files, plans, and knowledge artifacts from your local AI coding agent data. It exposes 5 MCP tools:

| Tool | Description |
|------|-------------|
| `logbook_search` | Full-text search across all agents with fuzzy matching, filtering by agent/type/date/project |
| `logbook_sessions` | Browse recent sessions sorted by recency |
| `logbook_read` | Retrieve messages from a specific session with context windowing and fuzzy query matching |
| `logbook_memory` | Search CLAUDE.md, GEMINI.md, AGENTS.md, and instruction files |
| `logbook_plans` | Search plan files, brain documents, and knowledge artifacts |

## Custom Data Locations

WheelDrop Logbook respects the same environment variables as the agents themselves:

| Agent | Variable | Default |
|-------|----------|---------|
| Claude Code | `CLAUDE_CONFIG_DIR` | `~/.claude` |
| Codex CLI | `CODEX_HOME` | `~/.codex` |
| Gemini CLI | `GEMINI_CLI_HOME` | `~` (`.gemini` created inside) |

If you use a nonstandard data directory for any agent, set the corresponding variable before running Logbook.

## Supported Data Sources

| Agent | Conversations | Memory | Plans | Subagents |
|-------|:---:|:---:|:---:|:---:|
| Claude Code | history.jsonl + session JSONL | CLAUDE.md (global + per-project) | plans/*.md | subagent sessions |
| Codex CLI | history.jsonl + date-tree sessions | AGENTS.md + rules/ | — | — |
| Gemini CLI | session JSON + logs.json (cleared sessions) | GEMINI.md | plans/*.md | — |

## Architecture

- **Transport**: stdio (local only, no network)
- **Search**: [MiniSearch](https://lucaong.github.io/minisearch/) with fuzzy matching and prefix search
- **Indexing**: Full session content indexed on first search, with score normalization to prevent long-document bias
- **Parsers**: Modular per-agent, implementing the `AgentParser` interface

## Development

```bash
git clone https://github.com/wheeldrop/logbook.git
cd logbook
npm install
npm run build
npm test              # 156 tests
npm run lint          # ESLint
npm run typecheck     # TypeScript strict mode
npm run test:coverage # Coverage with v8
npm run check         # All of the above
```

### Testing with MCP Inspector

```bash
npm run inspect
```

### Project Layout

```
src/
├── parsers/          # Per-agent parsers (claude, codex, gemini)
│   ├── types.ts      # AgentParser interface
│   └── registry.ts   # Parser auto-discovery
├── search/
│   ├── engine.ts     # MiniSearch wrapper with score normalization
│   ├── tokenizer.ts  # Shared tokenizer and fuzzy matching
│   └── types.ts      # Search options and result types
├── utils/            # Shared utilities (time, paths, jsonl, display)
├── install.ts        # --install auto-detection and configuration
├── server.ts         # MCP tool registration
└── index.ts          # Entry point (stdio transport + CLI flags)
skills/               # Codex skill
agents/               # Shared AGENTS.md for Gemini/Codex
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and pull request guidelines.

## License

Apache-2.0 — [Crash United, LLC](https://github.com/crashunited)

See [LICENSE](LICENSE) for the full text. Contributions require agreement to the
[Contributor License Agreement](CLA.md).
