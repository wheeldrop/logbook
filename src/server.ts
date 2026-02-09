import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { discoverParsers } from "./parsers/registry.js";
import { SearchEngine } from "./search/engine.js";
import { tokenize, levenshteinDistance } from "./search/tokenizer.js";
import type { AgentParser, AgentName } from "./parsers/types.js";
import type { SearchResult } from "./search/types.js";

const AGENT_NAMES = ["claude", "codex", "gemini", "antigravity"] as const;
const VALID_AGENTS = new Set<string>(AGENT_NAMES);
const DOC_TYPES = ["conversation", "memory", "plan", "knowledge"] as const;
const VALID_TYPES = new Set<string>(DOC_TYPES);

// Shared schema fragments
const agentFilterSchema = z
  .string()
  .default("all")
  .describe(
    "Agent filter: 'all', a single agent name (claude, codex, gemini, antigravity), " +
    "or comma-separated names (e.g. 'claude,codex')",
  );
const dateFromSchema = z.string().optional().describe("ISO 8601 date — only results after this date");
const dateToSchema = z.string().optional().describe("ISO 8601 date — only results before this date");

export async function createServerWithParsers(parsers: AgentParser[]): Promise<McpServer> {
  const server = new McpServer({
    name: "@wheeldrop/logbook",
    version: "0.1.0",
  });

  const engine = new SearchEngine(parsers);

  // ── Shared helpers ───────────────────────────────────────────────

  function findParser(agent: AgentName): AgentParser | undefined {
    return parsers.find((p) => p.name === agent);
  }

  function parseDateOpt(value: string | undefined): Date | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  }

  /** Parse agent filter string into engine-compatible format. */
  function parseAgentFilter(value: string): AgentName | AgentName[] | "all" {
    if (value === "all") return "all";
    const parts = value.split(",").map((s) => s.trim()).filter((s) => VALID_AGENTS.has(s));
    if (parts.length === 0) return "all";
    if (parts.length === 1) return parts[0] as AgentName;
    return parts as AgentName[];
  }

  /** Parse document type filter string into engine-compatible format. */
  function parseTypeFilter(
    value: string | undefined,
  ): SearchResult["type"] | SearchResult["type"][] | undefined {
    if (!value) return undefined;
    const parts = value.split(",").map((s) => s.trim()).filter((s) => VALID_TYPES.has(s));
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return parts[0] as SearchResult["type"];
    return parts as SearchResult["type"][];
  }

  /** Get parsers matching an agent filter. */
  function selectParsers(agent: AgentName | AgentName[] | "all"): AgentParser[] {
    if (agent === "all") return parsers;
    const agents = Array.isArray(agent) ? agent : [agent];
    return parsers.filter((p) => agents.includes(p.name));
  }

  // ── Tool 1: logbook_search ──────────────────────────────────────

  server.registerTool(
    "logbook_search",
    {
      title: "Logbook Search",
      description:
        "Full-text search across conversation logs, memory files, plans, and knowledge from all AI coding agents. " +
        "Returns multiple matched snippets per result showing different match locations, plus matchCount and " +
        "messageCount metadata for triage. Often sufficient without a follow-up logbook_read. " +
        "Use this to find past discussions, decisions, code explanations, or anything across agent history.",
      inputSchema: z.object({
        query: z.string().describe("Search query — supports fuzzy matching by default"),
        agent: agentFilterSchema,
        types: z
          .string()
          .optional()
          .describe(
            "Filter by document type(s): 'conversation', 'memory', 'plan', 'knowledge'. " +
            "Comma-separated for multiple (e.g. 'conversation,memory'). Omit for all types.",
          ),
        dateFrom: dateFromSchema,
        dateTo: dateToSchema,
        project: z.string().optional().describe("Filter by project path substring"),
        fuzzy: z.boolean().default(true).describe("Enable fuzzy matching (default true)"),
        minMessages: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Minimum message count — filters out short sessions (e.g. 1-message subagent prompts)"),
        limit: z.number().int().min(1).max(100).default(20).describe("Max results to return"),
        maxSnippets: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(3)
          .describe("Max snippets per result showing different match locations (default 3)"),
      }),
    },
    async ({ query, agent, types, dateFrom, dateTo, project, fuzzy, minMessages, limit, maxSnippets }) => {
      const results = await engine.search({
        query,
        agent: parseAgentFilter(agent),
        type: parseTypeFilter(types),
        dateFrom: parseDateOpt(dateFrom),
        dateTo: parseDateOpt(dateTo),
        project,
        fuzzy,
        minMessages,
        limit,
        maxSnippets,
      });

      const output = {
        totalResults: results.length,
        results: results.map((r) => ({
          agent: r.agent,
          sessionId: r.sessionId,
          timestamp: r.timestamp?.toISOString(),
          project: r.project,
          filePath: r.filePath,
          type: r.type,
          score: Math.round(r.score * 100) / 100,
          display: r.display,
          matchedText: r.matchedText,
          snippets: r.snippets.map((s) => ({ text: s.text, matchTerms: s.matchTerms })),
          matchCount: r.matchCount,
          messageCount: r.messageCount,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
      };
    },
  );

  // ── Tool 2: logbook_sessions ────────────────────────────────────

  server.registerTool(
    "logbook_sessions",
    {
      title: "Logbook Sessions",
      description:
        "List recent conversation sessions across AI coding agents. " +
        "Returns session summaries sorted by recency. Use this to browse recent activity " +
        "or find a specific session to retrieve with logbook_read.",
      inputSchema: z.object({
        agent: agentFilterSchema,
        dateFrom: dateFromSchema,
        dateTo: dateToSchema,
        project: z.string().optional().describe("Filter by project path substring"),
        limit: z.number().int().min(1).max(200).default(30).describe("Max sessions to return"),
      }),
    },
    async ({ agent, dateFrom, dateTo, project, limit }) => {
      const targetParsers = selectParsers(parseAgentFilter(agent));

      let allSessions = (
        await Promise.all(
          targetParsers.map((p) =>
            p.listSessions({
              dateFrom: parseDateOpt(dateFrom),
              dateTo: parseDateOpt(dateTo),
            }),
          ),
        )
      ).flat();

      if (project) {
        const lower = project.toLowerCase();
        allSessions = allSessions.filter(
          (s) => s.project && s.project.toLowerCase().includes(lower),
        );
      }

      allSessions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      allSessions = allSessions.slice(0, limit);

      const output = {
        totalSessions: allSessions.length,
        sessions: allSessions.map((s) => ({
          agent: s.agent,
          sessionId: s.sessionId,
          timestamp: s.timestamp.toISOString(),
          project: s.project,
          display: s.display,
          model: s.model,
          gitBranch: s.gitBranch,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
      };
    },
  );

  // ── Tool 3: logbook_read ────────────────────────────────────────

  server.registerTool(
    "logbook_read",
    {
      title: "Logbook Read",
      description:
        "Retrieve conversation content from a specific session. " +
        "Returns messages with roles, timestamps, and metadata. " +
        "Use a session ID obtained from logbook_search or logbook_sessions. " +
        "Supports context extraction: pass a query to find matching messages and " +
        "contextWindow to get surrounding messages. Set allMatches=true to get windows around " +
        "ALL matches in one call (merged when overlapping), reducing round trips. " +
        "Use offset/limit to paginate large sessions.",
      inputSchema: z.object({
        agent: z.enum(AGENT_NAMES).describe("The agent that owns this session"),
        sessionId: z.string().describe("Session ID from logbook_search or logbook_sessions"),
        query: z
          .string()
          .optional()
          .describe(
            "Find messages containing this text and center the result window around the match(es)",
          ),
        contextWindow: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe(
            "Number of messages to include before and after each matched message (requires query). " +
            "E.g. contextWindow=3 returns 7 messages per match: 3 before + match + 3 after.",
          ),
        allMatches: z
          .boolean()
          .default(false)
          .describe(
            "When true with a query, returns context windows around ALL matching messages " +
            "(merged when overlapping) instead of just the first match.",
          ),
        maxMatches: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe(
            "Max match locations to include windows for (requires allMatches=true). Omit for all.",
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Start from this message index (0-based). Use for pagination."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Max number of messages to return. Omit for all messages."),
      }),
    },
    async ({ agent, sessionId, query, contextWindow, allMatches, maxMatches, offset, limit }) => {
      const parser = findParser(agent as AgentName);
      if (!parser) {
        return {
          content: [{ type: "text" as const, text: `Agent "${agent}" not available.` }],
          isError: true,
        };
      }

      const session = await parser.getSession(sessionId);
      if (!session) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Session "${sessionId}" not found for agent "${agent}".`,
            },
          ],
          isError: true,
        };
      }

      const allMessages = session.messages;
      const totalMessages = allMessages.length;

      // Build query matcher if query is provided
      const queryWords = query ? tokenize(query) : [];

      const matchesMessage = (text: string): boolean => {
        if (queryWords.length === 0) return false;
        const lower = text.toLowerCase();

        // Fast path: exact substring match for every query word
        if (queryWords.every((w) => lower.includes(w))) return true;

        // Fuzzy fallback: tokenize message, check each query word against
        // message tokens with Levenshtein distance ≤ 2 (same threshold as
        // the search engine's snippet extraction)
        const msgTokens = tokenize(text);
        return queryWords.every((qw) =>
          msgTokens.some((mt) => {
            if (Math.abs(mt.length - qw.length) > 2) return false;
            return levenshteinDistance(mt, qw) <= 2;
          }),
        );
      };

      // ── allMatches mode: return merged windows around every match ──
      if (query && allMatches) {
        // Find all matching message indices
        const allMatchIndices = allMessages
          .map((m, i) => (matchesMessage(m.content) ? i : -1))
          .filter((i) => i !== -1);

        if (allMatchIndices.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    agent: session.agent,
                    sessionId: session.sessionId,
                    timestamp: session.timestamp.toISOString(),
                    project: session.project,
                    totalMessages,
                    totalMatches: 0,
                    queryNotFound: true,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Optionally limit number of match locations
        const selectedMatches = maxMatches
          ? allMatchIndices.slice(0, maxMatches)
          : allMatchIndices;

        // Build context windows around each match
        const cw = contextWindow ?? 0;
        const rawWindows = selectedMatches.map((idx) => ({
          start: Math.max(0, idx - cw),
          end: Math.min(totalMessages - 1, idx + cw),
          matchIndices: [idx],
        }));

        // Merge overlapping windows
        const merged: { start: number; end: number; matchIndices: number[] }[] = [];
        for (const win of rawWindows) {
          const last = merged[merged.length - 1];
          if (last && win.start <= last.end + 1) {
            last.end = Math.max(last.end, win.end);
            last.matchIndices.push(...win.matchIndices);
          } else {
            merged.push({ ...win, matchIndices: [...win.matchIndices] });
          }
        }

        // Build windows output
        const windows = merged.map((win) => ({
          startIndex: win.start,
          endIndex: win.end,
          matchIndices: win.matchIndices,
          messages: allMessages.slice(win.start, win.end + 1).map((m, i) => ({
            index: win.start + i,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp?.toISOString(),
            ...(win.matchIndices.includes(win.start + i) ? { matched: true } : {}),
          })),
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  agent: session.agent,
                  sessionId: session.sessionId,
                  timestamp: session.timestamp.toISOString(),
                  project: session.project,
                  totalMessages,
                  totalMatches: allMatchIndices.length,
                  windowedMatches: selectedMatches.length,
                  metadata: session.metadata,
                  windows,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── Single-match mode (existing behavior) ──
      let messages = allMessages;
      let matchIndex: number | undefined;

      if (query) {
        matchIndex = messages.findIndex((m) => matchesMessage(m.content));

        if (matchIndex !== -1 && contextWindow !== undefined) {
          const start = Math.max(0, matchIndex - contextWindow);
          const end = Math.min(messages.length, matchIndex + contextWindow + 1);
          messages = messages.slice(start, end);
          matchIndex = matchIndex - start;
        }
      }

      // Apply offset/limit pagination (after context window extraction)
      let sliceStart = 0;
      if (offset !== undefined && offset > 0) {
        sliceStart = Math.min(offset, messages.length);
        messages = messages.slice(sliceStart);
      }
      if (limit !== undefined) {
        messages = messages.slice(0, limit);
      }

      const output: Record<string, unknown> = {
        agent: session.agent,
        sessionId: session.sessionId,
        timestamp: session.timestamp.toISOString(),
        project: session.project,
        totalMessages,
        returnedMessages: messages.length,
        metadata: session.metadata,
        messages: messages.map((m, i) => ({
          index: sliceStart + i,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp?.toISOString(),
          ...(matchIndex !== undefined && i === matchIndex - sliceStart
            ? { matched: true }
            : {}),
        })),
      };

      if (matchIndex !== undefined && matchIndex !== -1) {
        output.matchedMessageIndex = matchIndex + sliceStart;
        output.allMatchIndices = allMessages
          .map((m, i) => (matchesMessage(m.content) ? i : -1))
          .filter((i) => i !== -1);
      } else if (query && (matchIndex === undefined || matchIndex === -1)) {
        output.queryNotFound = true;
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
      };
    },
  );

  // ── Tool 4: logbook_memory ──────────────────────────────────────

  server.registerTool(
    "logbook_memory",
    {
      title: "Logbook Memory",
      description:
        "Search memory and instruction files across agents — CLAUDE.md, GEMINI.md, AGENTS.md, " +
        "rules files, and other persistent configuration. Returns file paths for direct reading. " +
        "Use this to find coding conventions, project guidelines, or agent instructions.",
      inputSchema: z.object({
        query: z.string().describe("Search query for memory/instruction content"),
        agent: agentFilterSchema,
        dateFrom: dateFromSchema,
        dateTo: dateToSchema,
        limit: z.number().int().min(1).max(50).default(10).describe("Max results to return"),
      }),
    },
    async ({ query, agent, dateFrom, dateTo, limit }) => {
      const results = await engine.search({
        query,
        agent: parseAgentFilter(agent),
        type: "memory",
        dateFrom: parseDateOpt(dateFrom),
        dateTo: parseDateOpt(dateTo),
        fuzzy: true,
        limit,
      });

      const output = {
        totalResults: results.length,
        results: results.map((r) => ({
          agent: r.agent,
          filePath: r.filePath,
          score: Math.round(r.score * 100) / 100,
          matchedText: r.matchedText,
          snippets: r.snippets.map((s) => ({ text: s.text, matchTerms: s.matchTerms })),
          matchCount: r.matchCount,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
      };
    },
  );

  // ── Tool 5: logbook_plans ───────────────────────────────────────

  server.registerTool(
    "logbook_plans",
    {
      title: "Logbook Plans",
      description:
        "Search plan files, brain documents, and knowledge artifacts across agents. " +
        "Finds implementation plans, architecture decisions, project documentation, " +
        "and knowledge base entries. Returns file paths for direct reading.",
      inputSchema: z.object({
        query: z.string().describe("Search query for plan/knowledge content"),
        agent: agentFilterSchema,
        dateFrom: dateFromSchema,
        dateTo: dateToSchema,
        limit: z.number().int().min(1).max(50).default(10).describe("Max results to return"),
      }),
    },
    async ({ query, agent, dateFrom, dateTo, limit }) => {
      const results = await engine.search({
        query,
        agent: parseAgentFilter(agent),
        type: ["plan", "knowledge"],
        dateFrom: parseDateOpt(dateFrom),
        dateTo: parseDateOpt(dateTo),
        fuzzy: true,
        limit,
      });

      const output = {
        totalResults: results.length,
        results: results.map((r) => ({
          agent: r.agent,
          sessionId: r.sessionId,
          filePath: r.filePath,
          type: r.type,
          score: Math.round(r.score * 100) / 100,
          matchedText: r.matchedText,
          snippets: r.snippets.map((s) => ({ text: s.text, matchTerms: s.matchTerms })),
          matchCount: r.matchCount,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
      };
    },
  );

  return server;
}

export async function createServer(): Promise<McpServer> {
  const parsers = await discoverParsers();
  return createServerWithParsers(parsers);
}
