---
name: logbook-search
description: WheelDrop Logbook — search conversations across all AI coding agents
---

# WheelDrop Logbook

You have MCP tools for searching conversation history across AI coding agents (Claude Code, Codex, Gemini CLI).

## When to use the logbook

Reach for these tools when:
- The user asks about a past conversation, previous session, or prior decision
- You need context that might exist in another agent's history ("did we discuss this before?")
- You want to find project conventions, rules, or plans across agents
- The user says "search conversations", "what did we discuss", "logbook", etc.

## How to get good results

**Use short keyword queries** (2-3 specific terms), not natural language sentences. The search is fuzzy keyword-based, not semantic.

**The primary workflow is search then read:**
1. `logbook_search` to find relevant sessions (snippets are often enough to answer)
2. `logbook_read` with `query` + `contextWindow` + `allMatches: true` to drill into long sessions

**`logbook_memory`** and **`logbook_plans`** are shortcuts for searching memory files and plan documents respectively.

**`logbook_sessions`** lists recent sessions by recency — use when you don't have search terms.

<skills>
You have a SKILL documented in: "skills/logbook-search/SKILL.md"

IMPORTANT: Read the SKILL.md file for detailed search strategies, query formulation
tips, and recipes for common situations.

<available_skills>
logbook-search: Search past conversations across AI coding agents. Use when the user
asks to "search conversations", "find past discussion", "what did we discuss",
"previous session", "what was said about", "look up conversation", "logbook", or
wants to recall something from a prior coding session with any agent.
</available_skills>
</skills>
