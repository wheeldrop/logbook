# Competitor Analysis: Cross-Agent Conversation Search MCP Servers

> Analyzed 2026-02-07. Repos examined via GitHub API (not cloned locally due to sandbox restrictions).

---

## 1. ai-sessions-mcp (yoavf/ai-sessions-mcp)

**Language:** Go
**License:** (not specified in go.mod)
**Dependencies:** `go-sqlite3`, `go-sdk` (MCP Go SDK)
**Agents supported:** Claude Code, OpenAI Codex, Gemini CLI, opencode, Mistral Vibe, GitHub Copilot CLI
**Search:** Custom BM25 implementation with SQLite-backed inverted index

### Architecture

Clean adapter pattern. Each agent is a separate Go file implementing `SessionAdapter`:

```go
type SessionAdapter interface {
    Name() string
    ListSessions(projectPath string, limit int) ([]Session, error)
    GetSession(sessionID string, page, pageSize int) ([]Message, error)
    SearchSessions(projectPath, query string, limit int) ([]Session, error)
}
```

This is directly analogous to our `AgentParser` interface. The `Session` and `Message` types are the unified data model. The MCP server (`cmd/ai-sessions/main.go`) initializes all adapters and exposes 4 tools.

Key files:
- `adapters/types.go` - Interface + Session/Message types
- `adapters/claude.go` - Claude Code JSONL parser
- `adapters/codex.go` - Codex rollout-*.jsonl parser
- `adapters/gemini.go` - Gemini session-*.json parser
- `adapters/opencode.go` - opencode storage/message/*.json parser
- `adapters/mistral.go` - Mistral Vibe session_*.json parser
- `adapters/copilot.go` - GitHub Copilot session-state/*.jsonl parser
- `adapters/cursor.go` - Stub (not implemented; format uses SQLite+compressed blobs)
- `search/bm25.go` - BM25 scoring algorithm
- `search/cache.go` - SQLite-backed search cache + inverted index
- `search/schema.sql` - SQLite schema for sessions + term_index + stats

### Parser Implementation

**Claude parser (`adapters/claude.go`):**
- Reads `~/.claude/projects/[PROJECT_DIR]/*.jsonl`
- `PROJECT_DIR` = project path with slashes replaced by hyphens
- Handles both old format (top-level `content`) and new nested format (`message.content`)
- Fast pre-scan: uses `bytes.Contains(fileData, "type":"user")` before JSON parsing to skip empty sessions
- Strips system XML tags (`<ide_opened_file>`, `<system-reminder>`, etc.) from first message extraction
- Skips sidechain messages (`isSidechain: true`)
- Skips "Caveat:", `<command-name>`, `<bash-input>`, bracket-wrapped system messages
- Content can be string, []interface{} (text blocks), or map[string]interface{}
- Scanner buffer increased to 10MB per line for large messages

**Codex parser (`adapters/codex.go`):**
- Reads `~/.codex/sessions/` and `~/.codex/archived_sessions/` for `rollout-*.jsonl`
- Each line is a typed entry with `type` field: `session_meta`, `turn_context`, `response_item`
- Extracts CWD from `session_meta.payload.cwd` or `turn_context.payload.cwd`
- User messages are `response_item` entries with `payload.role == "user"` and `payload.type == "message"`
- User message content is in `payload.content[].input_text`
- Resolves symlinks via `filepath.EvalSymlinks`
- Skips `<user_instructions>` and `<environment_context>` XML-wrapped messages

**Gemini parser (`adapters/gemini.go`):**
- Reads `~/.gemini/tmp/[SHA256_HASH]/chats/session-*.json`
- Hash is SHA256 of absolute project path
- JSON files contain `sessionId`, `startTime`, `messages[]` with `role`/`type`/`content`
- Role normalization: "model"/"gemini" -> "assistant"
- Clever project path inference: when listing all sessions, extracts file paths from tool call arguments and message content, then tries hashing parent directories to match the hash
- Uses `extractPathsFromText()` to find potential paths in message content

**Copilot parser (`adapters/copilot.go`):**
- Reads `~/.copilot/session-state/*.jsonl`
- Event-based format: `session.start`, `session.info`, `user.message`, `assistant.message`, `tool.execution_start/complete`
- Project path from `folder_trust` info events (regex extraction)
- Fallback: infers project path from common directory of file paths in tool arguments
- `findCommonDirectory()` utility for path inference

**opencode parser (`adapters/opencode.go`):**
- Reads `~/.local/share/opencode/storage/`
- Three-level structure: `project/[ID].json` (metadata), `session/[PROJECT_ID]/ses_*.json`, `message/[SESSION_ID]/msg_*.json`
- Each message is a separate JSON file
- Matches project by worktree path

**Mistral parser (`adapters/mistral.go`):**
- Reads `~/.vibe/logs/session/session_*.json`
- Structured JSON with `metadata.session_id`, `metadata.start_time`, `metadata.environment.working_directory`
- Messages have `role`, `content`, `tool_calls[]`, `tool_call_results[]`

### Search Implementation

Custom BM25 implementation with SQLite-backed inverted index:

- **Tokenizer:** Simple Unicode letter/digit split, lowercased, tokens > 1 char
- **Indexing:** Lazy on first search. For each session, reads all messages, concatenates content, tokenizes, computes term frequencies, stores in `term_index` table
- **Cache invalidation:** Tracks `file_mtime` per session; re-indexes if file changed
- **BM25 scoring:** Standard k1=1.5, b=0.75 parameters
- **Schema:** `sessions` table (with full content stored for snippet extraction), `term_index` (term, session_id, term_frequency), `search_stats` (total_docs, avg_doc_length)
- **Snippet extraction:** Finds earliest occurrence of any query term, extracts surrounding text with word boundary alignment

### MCP Tool Design

4 tools exposed:

1. **`list_available_sources`** - Returns which agents have sessions available
2. **`list_sessions`** - List sessions with optional source/project/limit filters
3. **`search_sessions`** - BM25 search with source/project/limit filters. Returns score + snippet
4. **`get_session`** - Full session content with pagination (page/page_size)

All tools return JSON via `mcp.TextContent`. Uses Go SDK's typed argument structs with `jsonschema` tags.

### Strengths

1. **Broadest agent coverage** (6 agents) with clean adapter pattern
2. **Performance-conscious:** Fast byte pre-scan before JSON parsing; lazy indexing; SQLite cache
3. **BM25 is appropriate** for this use case - works well without requiring ML models
4. **Pagination support** in `get_session` for large conversations
5. **Good edge case handling:** system message filtering, sidechain detection, XML tag stripping, symlink resolution
6. **Gemini path inference** is clever - tries to reverse the SHA256 hash by hashing parent directories of paths found in messages
7. **Session-level granularity** for search (returns session matches, not individual messages)
8. **Stores full content in SQLite** for snippet extraction without re-reading files

### Weaknesses

1. **No semantic search** - only keyword/BM25. Can't find conceptually related content with different wording
2. **No time decay** in ranking - old results rank equally with recent ones
3. **Stores full content in SQLite** - duplicates storage and can bloat the cache database
4. **SearchSessions fallback** in adapters uses naive `strings.Contains` scan (only used as fallback, BM25 is primary)
5. **No incremental indexing** - indexes ALL sessions on first search, which could be slow with thousands of sessions
6. **Cursor adapter unimplemented** - acknowledges the difficulty of SQLite+compressed blob format
7. **Go binary** - larger binary size, not trivially installable via npm

### Specific Code Patterns to Adopt

- **Byte pre-scan optimization:** `bytes.Contains(fileData, "type":"user")` before JSON parsing
- **Scanner buffer sizing:** 1MB initial, 10MB max per line
- **Copilot project path inference** via common directory of tool call file paths
- **Gemini SHA256 path hashing** + reverse inference from message content
- **`extractFirstLine()` with 200-char truncation** as shared helper
- **System XML tag stripping** with iterative removal loop
- **`file_mtime` based cache invalidation** for lazy re-indexing

---

## 2. episodic-memory (obra/episodic-memory)

**Language:** TypeScript
**License:** MIT
**Dependencies:** `@xenova/transformers` (local embeddings), `better-sqlite3`, `sqlite-vec` (vector search), `@modelcontextprotocol/sdk`, `@anthropic-ai/claude-agent-sdk` (for summarization), `zod`
**Agents supported:** Claude Code only
**Search:** Semantic (vector) + text (LIKE) + multi-concept AND search

### Architecture

Distributed across several modules:

- `src/parser.ts` - JSONL parser for Claude Code conversations
- `src/indexer.ts` - Batch indexing pipeline (parse -> summarize -> embed -> store)
- `src/embeddings.ts` - Local embeddings via `@xenova/transformers` (all-MiniLM-L6-v2)
- `src/search.ts` - Vector similarity + text search + multi-concept
- `src/db.ts` - SQLite with `sqlite-vec` extension for vector search
- `src/mcp-server.ts` - MCP server with 2 tools
- `src/summarizer.ts` - AI-powered conversation summarization (uses Claude SDK)
- `src/sync.ts` - Incremental sync/indexing
- `src/show.ts` - Conversation display/formatting
- `src/paths.ts` - XDG-compliant path management

The key architectural decision is **exchange-level indexing**: conversations are split into user-assistant exchange pairs, each individually embedded and searchable. This gives finer granularity than session-level search.

### Parser Implementation

**Claude Code parser (`src/parser.ts`):**
- Reads JSONL files line-by-line using `readline` interface
- Groups messages into exchanges: a user message followed by one or more assistant messages
- Each exchange gets a deterministic ID: `md5(archivePath:lineStart-lineEnd)`
- Handles both string and structured content (text blocks, tool_use blocks)
- Extracts tool calls from `tool_use` blocks in assistant messages
- Tracks metadata per exchange: `parentUuid`, `isSidechain`, `sessionId`, `cwd`, `gitBranch`, `claudeVersion`, `thinkingLevel`, `thinkingDisabled`, `thinkingTriggers`
- Skips non-message types (only processes `type: "user"` and `type: "assistant"`)

**Key limitation:** Only parses Claude Code format. No other agents.

### Search Implementation

**Embedding model:** `Xenova/all-MiniLM-L6-v2` (384-dimensional, runs locally via ONNX)

**Database schema:**
- `exchanges` table: id, project, timestamp, user_message, assistant_message, archive_path, line_start, line_end, plus metadata columns
- `vec_exchanges` virtual table: `vec0` with `FLOAT[384]` embedding column
- `tool_calls` table: linked to exchanges

**Search modes:**
1. **Vector search:** Generate embedding for query, find nearest neighbors via `vec_exchanges MATCH`
2. **Text search:** `LIKE '%query%'` on user_message and assistant_message
3. **Both (default):** Merge and deduplicate results from both modes
4. **Multi-concept AND search:** Search each concept independently, find conversations matching ALL concepts, rank by average similarity

**Indexing pipeline:**
1. Scan `~/.claude/projects/` for JSONL files
2. Copy to archive directory (`~/.config/superpowers/conversation-archive/`)
3. Parse into exchanges
4. Generate AI summaries using Claude SDK (optional, configurable concurrency)
5. Generate embeddings for each exchange (combines user + assistant + tool names)
6. Store in SQLite + vector table

**Incremental indexing:** Checks `last_indexed` timestamp in DB; only processes new/unindexed conversations.

### MCP Tool Design

2 tools:

1. **`search`** - Unified search with rich parameters:
   - `query`: string (single concept) or string[] (2-5 concepts for AND search)
   - `mode`: "vector" | "text" | "both"
   - `limit`: 1-50
   - `after`/`before`: YYYY-MM-DD date filtering
   - `response_format`: "markdown" | "json"
   - Has `annotations` (readOnlyHint, idempotentHint, etc.)

2. **`read`** - Read full conversation with optional line range pagination:
   - `path`: absolute path to JSONL file
   - `startLine`/`endLine`: line-based pagination

The tool descriptions are carefully written for LLM consumption:
> "Gives you memory across sessions. You don't automatically remember past conversations - this tool restores context by searching them."

### Strengths

1. **Semantic search via local embeddings** - finds conceptually related content even with different wording
2. **Multi-concept AND search** - "find conversations about X and Y" - very powerful
3. **Exchange-level granularity** - returns specific user-assistant pairs, not whole sessions
4. **AI-powered summaries** for conversations
5. **Rich metadata tracking** - git branch, thinking level, Claude version, tool calls
6. **Date range filtering** in search queries
7. **XDG-compliant paths** with environment variable overrides
8. **Well-tested** - comprehensive test suite with fixtures
9. **Plugin system** - `.claude-plugin/` manifest, hooks, skills
10. **Tool annotations** with readOnly/idempotent hints
11. **Thoughtful MCP tool descriptions** written to guide LLM behavior
12. **Exclude list** for projects that shouldn't be indexed

### Weaknesses

1. **Claude Code only** - no support for other agents
2. **Heavy dependencies** - ONNX runtime, transformers.js, sqlite-vec native extension, Claude SDK
3. **Slow first-run** - downloads ~30MB model on first use, then generates embeddings for all conversations
4. **Requires separate indexing step** - `episodic-memory-index` must be run before search works
5. **AI summarization requires Claude API** - adds cost and latency
6. **No BM25 or TF-IDF** - text search is just `LIKE '%query%'`, missing ranking for text mode
7. **Vector search doesn't filter by time** - time filtering in SQL WHERE clause may not work correctly with `vec0 MATCH` queries (depends on sqlite-vec version)
8. **Archives conversations** by copying files - doubles storage
9. **512 token limit on embedding model** - truncates content to 2000 chars, so long conversations lose context

### Specific Code Patterns to Adopt

- **Exchange-level indexing** instead of session-level - much better search granularity
- **Multi-concept AND search** - search for conversations matching multiple concepts
- **Deterministic exchange IDs:** `md5(path:lineStart-lineEnd)` for stable references
- **Tool call extraction** from structured content blocks
- **`response_format` parameter** allowing markdown or JSON output
- **Thoughtful tool descriptions** that explain WHY to use the tool, not just HOW
- **Line-range pagination** for reading conversations
- **XDG-compliant paths** with env var overrides for testing
- **Exclude list** for projects to skip during indexing
- **`SUMMARIZER_CONTEXT_MARKER`** - excludes summarizer agent conversations from polluting search

---

## 3. claude-historian-mcp (Vvkmnn/claude-historian-mcp)

**Language:** TypeScript
**License:** MIT
**Dependencies:** `@modelcontextprotocol/sdk` (no heavy ML dependencies)
**Agents supported:** Claude Code (primary), Claude Desktop (attempted, disabled)
**Search:** In-memory regex/string matching with custom relevance scoring + semantic query expansion

### Architecture

- `src/index.ts` - MCP server with 8+ tools (most tools of any competitor)
- `src/parser.ts` - JSONL parser with rich context extraction
- `src/search.ts` - In-memory search engine with multi-strategy ranking (~64KB)
- `src/search-helpers.ts` - Query expansion, dedup, importance scoring
- `src/universal-engine.ts` - Attempted Claude Desktop integration (disabled)
- `src/formatter.ts` - Rich output formatting
- `src/types.ts` - Type definitions
- `src/utils.ts` - Utility functions

This is by far the most feature-rich implementation but also the most complex. The search engine alone is ~64KB of TypeScript.

### Parser Implementation

**Claude Code parser (`src/parser.ts`):**
- Standard JSONL reading with `createInterface`
- Rich context extraction per message:
  - `filesReferenced`: Extensive regex patterns for file paths (standard extensions, git status output, common config files, src/ paths)
  - `toolsUsed`: Extracts from `tool_use` blocks, `[Tool: X]` patterns, `mcp__` prefixes, and content text patterns
  - `errorPatterns`: Broad error detection (ENOENT, TypeError, "permission denied", etc.)
  - `bashCommands`: Extracts commands from tool_use inputs
  - `claudeInsights`: Regex extraction of solution/explanation patterns from assistant messages
  - `codeSnippets`: Code blocks and inline code extraction
  - `actionItems`: "Next step", "Run X", numbered/bullet lists
- **Smart content preservation:** Adaptive truncation based on content type (code, error, technical, conversational) with different character limits (3000-4000)
- **Content value scoring:** Prioritizes sentences with high-value keywords (solution, fix, error, function, etc.)

### Search Implementation

**No persistent index.** Everything is in-memory, computed per search:

1. Reads all JSONL files from `~/.claude/projects/`
2. Parses messages with relevance scoring
3. Multi-strategy search:
   - Query intent analysis (classifies as error/fix/implement/optimize/debug etc.)
   - Semantic query expansion (error -> exception/fail/crash/bug/issue)
   - Multi-pass scoring with time decay
   - Content deduplication by signature
   - "Importance scoring" based on "pain to rediscover" concept (decisions > bugfixes > features > discoveries)

**Time decay:** Recent messages get boosted (< 1 day: 1.5x, < 7 days: 1.2x, < 30 days: 1.1x)

**Query similarity:** Custom word-level similarity with stemming, stop word filtering, and technical synonym dictionaries

### MCP Tool Design

8+ tools exposed:

1. **`search_conversations`** - Main search (query, project, timeframe, limit)
2. **`get_conversation_detail`** - Full conversation by session ID
3. **`get_file_context`** - History of operations on a specific file
4. **`find_error_solutions`** - Search for error patterns and their solutions
5. **`get_tool_patterns`** - Analysis of tool usage patterns
6. **`get_project_overview`** - Project-level summary
7. **`search_plans`** - Search through Claude Code plan files
8. **`universal_search`** - Cross-source search (Claude Code + attempted Desktop)

Many tools also have specialized analysis features (risk assessment, success rates, prevention strategies).

### Strengths

1. **Richest context extraction** - files, tools, errors, insights, code snippets, action items per message
2. **Most MCP tools** - specialized tools for different use cases (errors, files, tool patterns, plans)
3. **Time decay in ranking** - recent results naturally rank higher
4. **Query expansion** with technical synonyms
5. **No heavy dependencies** - runs without ML models or native extensions
6. **Smart content truncation** - preserves code blocks and error messages preferentially
7. **"Pain to rediscover" importance scoring** - decisions and bugfixes rank higher than routine messages
8. **DXT packaging** - includes desktop extension manifest
9. **File context tracking** - can show history of operations on a specific file
10. **Error solution mining** - finds past solutions to similar errors

### Weaknesses

1. **No persistent index** - re-reads and re-parses all files on every search. Will be very slow with large histories
2. **Claude Code only** (Desktop integration disabled)
3. **No real semantic search** - just regex/string matching with synonym expansion
4. **Extremely complex code** - search.ts is 64KB with many nested heuristics
5. **Memory-intensive** - loads all messages into memory
6. **Many regex patterns** that could have false positives (e.g., error detection matching "error" in regular conversation)
7. **Over-engineered scoring** - many overlapping boost factors that are hard to tune
8. **No pagination** for large result sets in some tools

### Specific Code Patterns to Adopt

- **Rich context extraction** (files referenced, tools used, error patterns) per message
- **Time decay** in relevance scoring
- **"Pain to rediscover" importance scoring** concept
- **File context tracking** - "what happened to file X across all sessions"
- **Error solution mining** - "find past solutions to error pattern Y"
- **Smart content truncation** that preserves code blocks and error messages
- **Query expansion** with technical synonym dictionaries
- **Specialized tools** (file context, error solutions) beyond just "search" and "read"
- **Timeframe filter** as simple string ("today", "week", "month")

---

## 4. antigravity_decryptor (arashz/antigravity_decryptor)

**Language:** Python
**License:** (MIT implied)
**Dependencies:** `cryptography`, `protobuf`
**Purpose:** Decrypt Antigravity IDE's encrypted `.pb` conversation files

### Architecture

Single-file tool (`antigravity_decrypt.py`) with clear sections:
1. UI utilities (colors, progress bar)
2. Key management (macOS Keychain, env var, CLI arg)
3. Protobuf wire format parser
4. Decryption functions (AES-CTR, AES-CBC, AES-GCM)
5. Text extraction from protobuf fields
6. Main processing + CLI

### Decryption Algorithm (Critical Reference)

**Key retrieval priority:**
1. `--key` CLI argument (base64-encoded)
2. `ANTIGRAVITY_KEY` environment variable (base64-encoded)
3. macOS Keychain: service=`"Antigravity Safe Storage"`, account=`"Antigravity Key"` (via `security find-generic-password`)

**Decryption methods tried (in order):**
1. **AES-CTR** (primary): 16-byte nonce prefix, then encrypted data
2. **AES-CBC** (fallback): 16-byte IV prefix, PKCS7 padding
3. **AES-GCM** (fallback): 12-byte nonce prefix, last 16 bytes are tag

For each method, tries skip amounts of `[0, 1, 2, 4, 8]` bytes at the start of the file (header bytes), and post-decryption skip of `[0, 1, 2, 4, 8]` bytes.

**Validation:** Checks if decrypted data is valid protobuf (parses fields, needs >= 1 valid field) or at least 50+ printable UTF-8 characters.

### Protobuf Wire Format Parser

Implements a raw protobuf wire format parser (no .proto schema needed):

```python
def parse_protobuf_wire_format(data, max_depth=10, depth=0):
    # Parses varint tags, extracts field_number and wire_type
    # Wire types: 0=varint, 1=fixed64, 2=length-delimited, 5=fixed32
    # For length-delimited: recursively tries nested parsing, falls back to string
```

Key details:
- `decode_varint()`: Standard protobuf varint decoding with 64-bit overflow protection
- Max 100,000 iterations per parse call (safety limit)
- Max recursion depth of 10
- For length-delimited fields: tries nested protobuf first, then UTF-8 string
- Returns list of `{field_number, wire_type, wire_type_name, value}` dicts

### Text Extraction

```python
def extract_text_from_fields(fields, max_length=10000):
    # Recursively extracts "as_string" values from parsed protobuf fields
    # Filters: text must be > 5 chars stripped

def extract_conversation_messages(fields):
    # Filters texts that look like messages:
    # - Length > 10 chars
    # - Contains printable/space characters in first 100 chars
    # Returns [{content, length}]
```

### Strengths

1. **Multi-method decryption** - tries CTR, CBC, GCM with skip offsets
2. **Schema-less protobuf parsing** - works without .proto definition
3. **macOS Keychain integration** for key retrieval
4. **Batch processing** with progress bars
5. **Good error handling** and verbose mode
6. **Interactive mode** for beginners

### Weaknesses

1. **No message role attribution** - can't tell which text is user vs assistant
2. **No conversation structure** - just extracts all text strings
3. **Text extraction is lossy** - only gets strings > 5 chars from protobuf
4. **No timestamp extraction** - only file modification time
5. **Brute-force approach** to skip bytes (25 combinations tried per method)

### Specific Code Patterns to Adopt

- **Exact AES-CTR decryption:** `data[skip:skip+16]` = nonce, rest = ciphertext
- **Key from macOS Keychain:** `security find-generic-password -s "Antigravity Safe Storage" -a "Antigravity Key" -w`
- **Protobuf varint decoding:** Shift-and-mask with 7-bit continuation
- **Wire type dispatch:** tag >> 3 = field_number, tag & 7 = wire_type
- **Recursive nested field parsing** with depth limit
- **Multi-method fallback** approach for unknown encryption parameters

---

## Comparative Summary

| Feature | ai-sessions-mcp | episodic-memory | claude-historian-mcp | convo-mcp (ours) |
|---------|-----------------|-----------------|---------------------|------------------|
| Language | Go | TypeScript | TypeScript | TypeScript |
| Agents | 6 | 1 (Claude) | 1 (Claude) | 4 (Claude, Codex, Gemini, Antigravity) |
| Search | BM25 + SQLite | Semantic + Text | In-memory regex | MiniSearch (TF-IDF) |
| Persistent Index | Yes (SQLite) | Yes (SQLite+vec) | No | No (in-memory) |
| Semantic Search | No | Yes (local) | Pseudo (synonyms) | No |
| Time Decay | No | No | Yes | No |
| Granularity | Session | Exchange | Message | Document |
| MCP Tools | 4 | 2 | 8+ | (varies) |
| Dependencies | go-sqlite3 | onnxruntime, transformers.js, sqlite-vec | None heavy | minisearch |
| Memory Files | No | No | Yes (plans) | Yes |

---

## Key Takeaways for convo-mcp

### High-Priority Adoptions

1. **From ai-sessions-mcp:**
   - Byte pre-scan optimization before JSON parsing (significant speedup for large session dirs)
   - Copilot and Mistral adapter implementations (expand agent coverage to 6+)
   - `file_mtime` based cache invalidation for lazy re-indexing
   - Session pagination in `get_session` tool

2. **From episodic-memory:**
   - Exchange-level indexing (user+assistant pairs) for finer search granularity
   - Multi-concept AND search capability
   - `response_format` parameter (markdown vs JSON)
   - Thoughtful MCP tool descriptions optimized for LLM consumption
   - Date range filtering in search
   - Tool annotations (readOnlyHint, idempotentHint)

3. **From claude-historian-mcp:**
   - Time decay in relevance scoring
   - Rich per-message context extraction (files, tools, errors)
   - Specialized tools: file context, error solutions, tool patterns
   - Timeframe filter as simple string ("today", "week", "month")

4. **From antigravity_decryptor:**
   - Exact AES-CTR decryption implementation with nonce extraction
   - macOS Keychain key retrieval
   - Schema-less protobuf wire format parser with recursive field extraction
   - Multi-method fallback (CTR -> CBC -> GCM) with skip offsets

### Architecture Decisions

- **Keep MiniSearch** for now (lightweight, fast, no native deps) but add exchange-level documents
- **Add SQLite caching** for persistent index to avoid re-indexing on every startup
- **Consider adding sqlite-vec** later for semantic search (only if users need it)
- **Expand agent coverage** - Copilot and Mistral formats are well-documented in ai-sessions-mcp
- **Add specialized tools** beyond search/read (file context, error solutions)
- **Implement time decay** in scoring - straightforward and high-value
- **Add byte pre-scan** optimization to Claude parser for performance

### Anti-Patterns to Avoid

- **claude-historian-mcp's in-memory everything** - doesn't scale
- **claude-historian-mcp's over-engineered scoring** - too many overlapping heuristic boosts
- **episodic-memory's heavy dependencies** - ONNX runtime is a deployment burden
- **episodic-memory's mandatory separate indexing step** - should index lazily
- **Storing full content in SQLite** (ai-sessions-mcp) - better to read from source files for snippets
