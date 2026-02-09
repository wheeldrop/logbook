# WheelDrop Logbook

MCP server for searching conversation logs across AI coding agents.

## Architecture

- TypeScript MCP server using `@modelcontextprotocol/sdk`, stdio transport
- Modular parser system: one parser per agent implementing `AgentParser` interface
- MiniSearch-based tiered full-text search with fuzzy matching
- Native extensions for Gemini CLI, Codex, and Claude Code

## Build & Test

```bash
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm run inspect      # Test with MCP Inspector
npm test             # Run tests
```

## Project Layout

- `src/parsers/types.ts` — Core interfaces (AgentParser, SessionSummary, etc.)
- `src/parsers/{claude,codex,gemini,antigravity}.ts` — Per-agent parsers
- `src/parsers/antigravity-decrypt.ts` — AES decryption + protobuf wire-format parser
- `src/search/engine.ts` — MiniSearch wrapper with tiered indexing
- `src/server.ts` — MCP tool and resource registration
- `src/index.ts` — Entry point (stdio transport)
- `agents/AGENTS.md` — Shared context for Gemini CLI + Codex users
- `skills/logbook-search/SKILL.md` — Agent skill (shared across Claude + Codex)
- `.claude-plugin/` — Claude Code plugin manifests
- `gemini-extension.json` — Gemini CLI extension manifest
- `server.json` — MCP Registry manifest

## Conventions

- All logging to stderr (`console.error`), never stdout (reserved for JSON-RPC)
- Input validation via zod schemas
- Timestamps normalized to Date objects via `src/utils/time.ts`
- Agent parsers are stateless — all state lives in the search engine
