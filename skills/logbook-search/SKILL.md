---
name: logbook-search
description: >
  Search past conversations across AI coding agents. Use when the user asks to
  "search conversations", "find past discussion", "what did we discuss",
  "previous session", "what was said about", "look up conversation", "logbook",
  or wants to recall something from a prior coding session with any agent.
---

# Using the Logbook

You have 5 MCP tools for searching conversation history across Claude Code, Codex, and Gemini CLI. The two you'll use most are **logbook_search** (find sessions) and **logbook_read** (read into a session). The others are shortcuts.

## Writing good queries

Search quality depends almost entirely on query formulation. The search engine uses fuzzy keyword matching — not semantic understanding.

**Use 2-3 specific keyword tokens**, not natural language:
- Good: `XFCC parsing multi-hop` — specific, distinctive terms
- Good: `score normalization dampening` — domain keywords
- Bad: `how did we fix the problem with header parsing` — too many common words dilute the match
- Bad: `what was the decision about the architecture` — vague, matches everything

**Combine multiple identifying terms** to anchor intent. If one term is common (like a project name), pair it with distinctive terms:
- `chirp MU-5 driver` instead of just `MU-5` (which fuzzy-matches "mu" in "mutation")
- `stryker safeCallHook survived` instead of just `stryker` or `mutation testing`

**Short and hyphenated terms produce noise.** `MU-5` tokenizes into `MU` + `5` and fuzzy-matches unrelated content. Combine with other terms or use `fuzzy: false` to reduce noise (though this disables typo tolerance).

**Reformulate if the first search misses.** Try synonyms, more specific terms, or different keyword combinations. Iterative searching is normal — most questions take 2-3 queries.

## The core workflow: search, triage, drill in

### 1. Search with logbook_search

Start broad. The results include **multiple snippets per hit** showing different match locations — often enough to answer the question without reading full sessions.

Use these fields to triage results:
- **score** — higher is more relevant (fuzzy TF-IDF, normalized for document length)
- **matchCount** — how many times query terms appear in this session. High count (50+) can mean a deep discussion *or* a long session with incidental matches
- **messageCount** — total messages in the session. A 5-message session with matchCount 10 is more focused than a 300-message session with matchCount 10
- **snippets** — scan these first; they often contain the answer directly
- **display** — first user message, useful for identifying what the session was about

### 2. Drill into promising sessions with logbook_read

Once you find a relevant session, use `logbook_read` with the `agent` and `sessionId` from the search result.

**For long sessions** (50+ messages), always use `query` + `contextWindow` + `allMatches: true`:
```
logbook_read(agent, sessionId, query="XFCC parsing", contextWindow=5, allMatches=true)
```
This returns merged windows around every matching message — far more efficient than paginating. Each window includes surrounding context so you can follow the conversation.

**Tip:** `logbook_read`'s query matching checks each message individually (all query words must match in a single message, with fuzzy fallback for near-misses). If read says `queryNotFound`, the session may discuss the topic across messages rather than in one. Try fewer query words or a broader term.

### 3. Iterate as needed

If results aren't relevant, reformulate the query. If you found the right session but need more context, widen the `contextWindow` or use `offset`/`limit` to paginate.

## Recipes for common situations

### "What was the decision about X?"
Search for the topic keywords. Look for sessions with moderate matchCount (5-20) — these are usually focused discussions rather than passing mentions. Drill in with `logbook_read` to find the decision point.

### "What are the project conventions / rules?"
Use **logbook_memory** — it searches CLAUDE.md, GEMINI.md, AGENTS.md, rules files, and other persistent configuration. These are distilled guidelines, not raw conversation.
```
logbook_memory(query="test patterns error handling")
```

### "What was planned for X?"
Use **logbook_plans** — it searches plan files, brain documents, and knowledge artifacts.
```
logbook_plans(query="authentication refactor architecture")
```

### "What was I working on recently?"
Use **logbook_sessions** — it lists recent sessions sorted by recency. No search query needed.
```
logbook_sessions(project="my-project", limit=10)
```

### "What problems did we hit on this project?"
Search with project filter + problem-domain keywords. Expect to make multiple searches — bugs, errors, and issues are described in varied language. Also check `logbook_memory` for the project's memory files, which often contain distilled issue lists.
```
logbook_search(query="bug fix error", project="my-project", types="conversation")
logbook_memory(query="issues known problems", project="my-project")
```

### "Find something across all agents"
Leave `agent` as default (`all`). The same topic is often discussed in different agents — Claude Code, Gemini CLI, and Codex sessions can all contain pieces of the story. Cross-agent synthesis is one of the logbook's most powerful capabilities.

## Filtering and narrowing

- **agent** — `claude`, `codex`, `gemini`, or comma-separated (e.g., `claude,codex`)
- **types** — `conversation`, `memory`, `plan`, `knowledge` (comma-separated). Use `types: "conversation"` to exclude memory/plan files and reduce noise
- **project** — substring match on project path (e.g., `client-certificate-auth`)
- **dateFrom / dateTo** — ISO 8601 dates for time-scoped searches
- **maxSnippets** — up to 5 snippets per result (default 3) for richer triage

## Tool reference

| Tool | Purpose | When to use |
|------|---------|-------------|
| **logbook_search** | Full-text search across everything | Primary discovery tool — start here |
| **logbook_read** | Read messages from a specific session | After search gives you a sessionId |
| **logbook_memory** | Search memory/instruction files | Looking for conventions, rules, guidelines |
| **logbook_plans** | Search plans and knowledge docs | Looking for architecture decisions, plans |
| **logbook_sessions** | Browse recent sessions by recency | No search terms — just want recent activity |

`logbook_memory` and `logbook_plans` are convenience shortcuts — they run `logbook_search` with a pre-set type filter. You can achieve the same with `logbook_search(types="memory")` or `logbook_search(types="plan,knowledge")`.
