# Changelog

All notable changes to WheelDrop Logbook will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] — 2026-02-09

### Fixed

- **`bin` entry stripped during publish** — npm 11.x requires bin paths without leading `./`; `npx @wheeldrop/logbook` now works correctly
- **TOCTOU race conditions** in installer — replaced `existsSync` guards with try/catch `ENOENT` pattern (CodeQL `js/file-system-race`)

## [0.1.0] — 2026-02-09

Initial release.

### Added

- **MCP server** with 5 tools: `logbook_search`, `logbook_sessions`, `logbook_read`, `logbook_memory`, `logbook_plans`
- **Parsers** for Claude Code, Codex CLI, and Gemini CLI conversation data
- **Claude Code subagent indexing** — indexes subagent sessions (first message per subagent)
- **MiniSearch-based search engine** with fuzzy matching, prefix search, and score normalization
- **Scoped filtering** — filter by agent (single, multi, or all), document type, date range, and project
- **Context windowing** — `logbook_read` supports `query` + `contextWindow` to center results on matching messages, plus `offset`/`limit` for pagination
- **Fuzzy query matching** in `logbook_read` via shared tokenizer and Levenshtein fallback
- **Display filtering** — `display` field skips non-displayable messages (interrupted requests, local command caveats, `/resume`, short text)
- **`minMessages` filter** on `logbook_search` — post-filters sessions by minimum message count
- **Codex duplicate deduplication** — consecutive identical assistant messages collapsed in `logbook_read`
- **Memory file indexing** — CLAUDE.md (global + per-project), AGENTS.md, GEMINI.md, user rules
- **Plan file indexing** — Gemini CLI plans, Claude Code plans
- **File paths in results** — search results include file paths for memory, plan, and knowledge documents
- **Environment variable support** — respects `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME` for nonstandard data locations
- **Auto-installer** — `npx @wheeldrop/logbook --install` detects agents and configures them all automatically
- **Platform extensions**: Claude Code plugin, Codex skill, Gemini CLI extension
- **Agent skill** — `SKILL.md` teaches agents the search→sessions→read drill-in workflow
- **Test suite** — 156 tests with Vitest covering parsers, search engine, MCP integration, and utilities
- **Dev tooling** — ESLint, Husky + commitlint, Stryker mutation testing, v8 coverage with thresholds
- **CI/CD** — GitHub Actions for CI (Node 20/22/24/25 matrix), CodeQL security scanning, mutation testing, and npm publish with provenance
- **Project infrastructure** — CLA, CONTRIBUTING.md, SECURITY.md, issue templates, PR template, dependabot, GitHub Sponsors
