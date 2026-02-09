# Changelog

All notable changes to WheelDrop Logbook will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Rebranded** from `convo-mcp` to **WheelDrop Logbook** (`@wheeldrop/logbook`)
- **Renamed MCP tools** with `logbook_` prefix: `logbook_search`, `logbook_sessions`, `logbook_read`, `logbook_memory`, `logbook_plans`
- **Updated extensions** — Gemini CLI extension, Codex skill, and Claude Code skill all reference new tool names

## [0.1.0] — 2026-02-07

Initial release.

### Added

- **MCP server** with 5 tools: `search_conversations`, `list_sessions`, `get_session`, `search_memory`, `search_plans`
- **Parsers** for Claude Code, Codex CLI, and Gemini CLI conversation data
- **Claude Code subagent indexing** — searches subagent sessions (first message per subagent for fast Tier 1 results)
- **MiniSearch-based search engine** with fuzzy matching, prefix search, and tiered indexing
- **Scoped filtering** — filter by agent (single, multi, or all), document type, date range, and project
- **Context windowing** — `get_session` supports `query` + `contextWindow` to center results on matching messages, plus `offset`/`limit` for pagination
- **File paths in results** — search results include file paths for memory, plan, and knowledge documents
- **Environment variable support** — respects `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME` for nonstandard data locations
- **Platform extensions**: Claude Code plugin, Codex skill, Gemini CLI extension
- **Auto-installer** — `install.sh` detects agents and configures them all automatically
- **Test suite** — 116 tests with Vitest covering parsers, search engine, MCP integration, and utilities
- **Dev tooling** — ESLint, Husky + commitlint, Stryker mutation testing config, v8 coverage with thresholds
- **CI/CD** — GitHub Actions workflows for CI (Node 20/22/24 matrix), mutation testing, and npm publish with provenance
