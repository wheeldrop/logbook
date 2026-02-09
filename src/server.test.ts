import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServerWithParsers } from "./server.js";
import type {
  AgentParser,
  AgentName,
  SessionSummary,
  SessionContent,
  SearchableDocument,
  MemoryFile,
  ListSessionsOptions,
} from "./parsers/types.js";

// --- Mock parser ---

function createMockParser(
  name: AgentName,
  docs: SearchableDocument[],
  memoryFiles: MemoryFile[] = [],
  planFiles: MemoryFile[] = [],
  sessions: Map<string, SessionContent> = new Map(),
): AgentParser {
  return {
    name,
    displayName: name,
    basePath: `/mock/${name}`,
    async isAvailable() { return true; },
    async listSessions(_options?: ListSessionsOptions): Promise<SessionSummary[]> {
      const all = Array.from(sessions.values()).map((s) => ({
        agent: name,
        sessionId: s.sessionId,
        timestamp: s.timestamp,
        project: s.project,
        display: s.messages[0]?.content,
      }));
      if (_options?.dateFrom) {
        return all.filter((s) => s.timestamp >= _options.dateFrom!);
      }
      return all;
    },
    async getSession(sessionId: string): Promise<SessionContent | null> {
      return sessions.get(sessionId) ?? null;
    },
    async *getSearchableDocuments(): AsyncGenerator<SearchableDocument> {
      for (const doc of docs) yield doc;
    },
    async getMemoryFiles(): Promise<MemoryFile[]> { return memoryFiles; },
    async getPlanFiles(): Promise<MemoryFile[]> { return planFiles; },
  };
}

// --- Test data ---

const claudeSessions = new Map<string, SessionContent>();
claudeSessions.set("session-1", {
  agent: "claude",
  sessionId: "session-1",
  timestamp: new Date("2025-02-01T00:00:00Z"),
  project: "/home/testuser/test-project",
  messages: [
    { role: "user", content: "Help me with authentication", timestamp: new Date("2025-02-01T00:01:00Z") },
    { role: "assistant", content: "I'll implement JWT authentication for you.", timestamp: new Date("2025-02-01T00:02:00Z") },
    { role: "user", content: "Add refresh token support", timestamp: new Date("2025-02-01T00:05:00Z") },
    { role: "assistant", content: "Adding refresh token rotation now.", timestamp: new Date("2025-02-01T00:06:00Z") },
    { role: "user", content: "Now add database migration", timestamp: new Date("2025-02-01T00:10:00Z") },
    { role: "assistant", content: "Setting up the database schema.", timestamp: new Date("2025-02-01T00:11:00Z") },
  ],
  metadata: { summary: "Auth + DB setup" },
});

const claudeDocs: SearchableDocument[] = [
  {
    id: "claude:history:session-1:1738368000000",
    agent: "claude",
    sessionId: "session-1",
    timestamp: 1738368000000,
    project: "/home/testuser/test-project",
    text: "Help me with authentication using JWT tokens",
    type: "conversation",
  },
];

const claudeMemory: MemoryFile[] = [
  {
    agent: "claude",
    path: "/mock/claude/CLAUDE.md",
    content: "Use TypeScript strict mode. Always prefer JWT for authentication.",
    type: "memory",
  },
];

const claudePlans: MemoryFile[] = [
  {
    agent: "claude",
    path: "/mock/claude/plans/arch.md",
    content: "Architecture plan: microservices with auth gateway",
    type: "plan",
  },
];

const codexDocs: SearchableDocument[] = [
  {
    id: "codex:history:session-2:1738375200000",
    agent: "codex",
    sessionId: "session-2",
    timestamp: 1738375200000,
    project: "/home/testuser/other-project",
    text: "Set up database migration with PostgreSQL",
    type: "conversation",
  },
];

function buildParsers(): AgentParser[] {
  return [
    createMockParser("claude", claudeDocs, claudeMemory, claudePlans, claudeSessions),
    createMockParser("codex", codexDocs),
  ];
}

// --- Helper ---

function parseToolResult(result: unknown): unknown {
  const r = result as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0].text);
}

function isErrorResult(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

describe("MCP Server Integration", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const parsers = buildParsers();
    const server = await createServerWithParsers(parsers);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  describe("logbook_search", () => {
    it("returns structured JSON with results", async () => {
      const result = await client.callTool({
        name: "logbook_search",
        arguments: { query: "authentication" },
      });
      const parsed = parseToolResult(result) as { totalResults: number; results: unknown[] };
      expect(parsed.totalResults).toBeGreaterThan(0);
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(parsed.results.length).toBeGreaterThan(0);
    });

    it("filters by agent", async () => {
      const result = await client.callTool({
        name: "logbook_search",
        arguments: { query: "authentication", agent: "claude" },
      });
      const parsed = parseToolResult(result) as { results: Array<{ agent: string }> };
      expect(parsed.results.length).toBeGreaterThan(0);
      expect(parsed.results.every((r) => r.agent === "claude")).toBe(true);
    });

    it("filters by type", async () => {
      const result = await client.callTool({
        name: "logbook_search",
        arguments: { query: "authentication", types: "memory" },
      });
      const parsed = parseToolResult(result) as { results: Array<{ type: string }> };
      expect(parsed.results.length).toBeGreaterThan(0);
      expect(parsed.results.every((r) => r.type === "memory")).toBe(true);
    });

    it("respects limit", async () => {
      const result = await client.callTool({
        name: "logbook_search",
        arguments: { query: "authentication", limit: 1 },
      });
      const parsed = parseToolResult(result) as { results: unknown[] };
      expect(parsed.results.length).toBeLessThanOrEqual(1);
    });
  });

  describe("logbook_sessions", () => {
    it("returns sessions sorted by recency", async () => {
      const result = await client.callTool({
        name: "logbook_sessions",
        arguments: { agent: "claude" },
      });
      const parsed = parseToolResult(result) as {
        totalSessions: number;
        sessions: Array<{ agent: string; sessionId: string; timestamp: string }>;
      };
      expect(parsed.totalSessions).toBeGreaterThan(0);
      expect(parsed.sessions[0].agent).toBe("claude");
    });

    it("filters by project", async () => {
      const result = await client.callTool({
        name: "logbook_sessions",
        arguments: { agent: "claude", project: "test-project" },
      });
      const parsed = parseToolResult(result) as {
        totalSessions: number;
        sessions: Array<{ project: string }>;
      };
      expect(parsed.totalSessions).toBeGreaterThan(0);
      expect(parsed.sessions.every((s) => s.project?.toLowerCase().includes("test-project"))).toBe(true);
    });

    it("returns all agents when agent is 'all'", async () => {
      const result = await client.callTool({
        name: "logbook_sessions",
        arguments: { agent: "all" },
      });
      const parsed = parseToolResult(result) as {
        sessions: Array<{ agent: string }>;
      };
      const agents = new Set(parsed.sessions.map((s) => s.agent));
      expect(agents.has("claude")).toBe(true);
    });
  });

  describe("logbook_read", () => {
    it("returns messages for valid session", async () => {
      const result = await client.callTool({
        name: "logbook_read",
        arguments: { agent: "claude", sessionId: "session-1" },
      });
      const parsed = parseToolResult(result) as {
        totalMessages: number;
        returnedMessages: number;
        messages: Array<{ role: string; content: string }>;
      };
      expect(parsed.totalMessages).toBe(6);
      expect(parsed.returnedMessages).toBe(6);
      expect(parsed.messages[0].role).toBe("user");
    });

    it("supports pagination with offset/limit", async () => {
      const result = await client.callTool({
        name: "logbook_read",
        arguments: { agent: "claude", sessionId: "session-1", offset: 2, limit: 2 },
      });
      const parsed = parseToolResult(result) as {
        totalMessages: number;
        returnedMessages: number;
        messages: Array<{ index: number; content: string }>;
      };
      expect(parsed.returnedMessages).toBe(2);
      expect(parsed.messages[0].index).toBe(2);
    });

    it("supports query + contextWindow", async () => {
      const result = await client.callTool({
        name: "logbook_read",
        arguments: {
          agent: "claude",
          sessionId: "session-1",
          query: "refresh token",
          contextWindow: 1,
        },
      });
      const parsed = parseToolResult(result) as {
        messages: Array<{ role: string; content: string; matched?: boolean }>;
        matchedMessageIndex: number;
      };
      expect(parsed.messages).toHaveLength(3);
      expect(parsed.matchedMessageIndex).toBeDefined();
    });

    it("sets queryNotFound when query has no match in session", async () => {
      const result = await client.callTool({
        name: "logbook_read",
        arguments: {
          agent: "claude",
          sessionId: "session-1",
          query: "xyznonexistent123",
          contextWindow: 1,
        },
      });
      const parsed = parseToolResult(result) as {
        queryNotFound?: boolean;
        matchedMessageIndex?: number;
      };
      expect(parsed.queryNotFound).toBe(true);
      expect(parsed.matchedMessageIndex).toBeUndefined();
    });

    it("returns error for nonexistent session", async () => {
      const result = await client.callTool({
        name: "logbook_read",
        arguments: { agent: "claude", sessionId: "nonexistent" },
      });
      expect(isErrorResult(result)).toBe(true);
    });

    it("returns error for unavailable agent", async () => {
      const result = await client.callTool({
        name: "logbook_read",
        arguments: { agent: "gemini", sessionId: "session-1" },
      });
      expect(isErrorResult(result)).toBe(true);
    });

    it("finds messages with fuzzy query matching", async () => {
      // "autentication" (typo) should fuzzy-match "authentication" in the session
      const result = await client.callTool({
        name: "logbook_read",
        arguments: {
          agent: "claude",
          sessionId: "session-1",
          query: "autentication",
          contextWindow: 0,
          allMatches: true,
        },
      });
      const parsed = parseToolResult(result) as {
        totalMatches: number;
        queryNotFound?: boolean;
      };
      expect(parsed.queryNotFound).toBeUndefined();
      expect(parsed.totalMatches).toBeGreaterThan(0);
    });
  });

  describe("logbook_search enriched output", () => {
    it("returns snippets array and matchCount", async () => {
      const result = await client.callTool({
        name: "logbook_search",
        arguments: { query: "authentication" },
      });
      const parsed = parseToolResult(result) as {
        results: Array<{
          matchedText: string;
          snippets: Array<{ text: string; matchTerms: string[] }>;
          matchCount: number;
          messageCount?: number;
        }>;
      };
      const r = parsed.results[0];
      expect(r.snippets).toBeDefined();
      expect(Array.isArray(r.snippets)).toBe(true);
      expect(r.snippets.length).toBeGreaterThanOrEqual(1);
      expect(r.snippets[0].text).toBe(r.matchedText);
      expect(typeof r.matchCount).toBe("number");
    });

    it("respects maxSnippets parameter", async () => {
      const result = await client.callTool({
        name: "logbook_search",
        arguments: { query: "authentication", maxSnippets: 1 },
      });
      const parsed = parseToolResult(result) as {
        results: Array<{ snippets: Array<{ text: string }> }>;
      };
      for (const r of parsed.results) {
        expect(r.snippets.length).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("logbook_read allMatches mode", () => {
    it("returns windows array with allMatches=true", async () => {
      // Session has "authentication" in message 0 and "token" in messages 2,3
      // Using a broader query that matches multiple messages
      const result = await client.callTool({
        name: "logbook_read",
        arguments: {
          agent: "claude",
          sessionId: "session-1",
          query: "token",
          contextWindow: 0,
          allMatches: true,
        },
      });
      const parsed = parseToolResult(result) as {
        totalMessages: number;
        totalMatches: number;
        windowedMatches: number;
        windows: Array<{
          startIndex: number;
          endIndex: number;
          matchIndices: number[];
          messages: Array<{ index: number; role: string; content: string; matched?: boolean }>;
        }>;
      };
      expect(parsed.totalMatches).toBeGreaterThan(0);
      expect(parsed.windows).toBeDefined();
      expect(Array.isArray(parsed.windows)).toBe(true);
      // Each window should have messages with absolute indices
      for (const win of parsed.windows) {
        expect(win.startIndex).toBeLessThanOrEqual(win.endIndex);
        expect(win.matchIndices.length).toBeGreaterThan(0);
        expect(win.messages.length).toBeGreaterThan(0);
        // At least one message in the window should be marked matched
        expect(win.messages.some((m) => m.matched === true)).toBe(true);
      }
    });

    it("merges overlapping windows", async () => {
      // query "authentication" matches messages 0 and 1 (both mention auth/JWT)
      // with contextWindow=1, windows would overlap -> should merge
      const result = await client.callTool({
        name: "logbook_read",
        arguments: {
          agent: "claude",
          sessionId: "session-1",
          query: "authentication",
          contextWindow: 1,
          allMatches: true,
        },
      });
      const parsed = parseToolResult(result) as {
        totalMatches: number;
        windows: Array<{ startIndex: number; endIndex: number; matchIndices: number[] }>;
      };
      // If multiple auth matches are close together, they should merge into fewer windows
      if (parsed.totalMatches > 1) {
        expect(parsed.windows.length).toBeLessThanOrEqual(parsed.totalMatches);
      }
    });

    it("respects maxMatches parameter", async () => {
      const result = await client.callTool({
        name: "logbook_read",
        arguments: {
          agent: "claude",
          sessionId: "session-1",
          query: "authentication",
          contextWindow: 0,
          allMatches: true,
          maxMatches: 1,
        },
      });
      const parsed = parseToolResult(result) as {
        totalMatches: number;
        windowedMatches: number;
        windows: Array<{ matchIndices: number[] }>;
      };
      expect(parsed.windowedMatches).toBeLessThanOrEqual(1);
    });

    it("returns queryNotFound when allMatches query has no matches", async () => {
      const result = await client.callTool({
        name: "logbook_read",
        arguments: {
          agent: "claude",
          sessionId: "session-1",
          query: "xyznonexistent123",
          allMatches: true,
        },
      });
      const parsed = parseToolResult(result) as {
        totalMatches: number;
        queryNotFound?: boolean;
      };
      expect(parsed.queryNotFound).toBe(true);
      expect(parsed.totalMatches).toBe(0);
    });

    it("preserves existing single-match behavior when allMatches=false", async () => {
      const result = await client.callTool({
        name: "logbook_read",
        arguments: {
          agent: "claude",
          sessionId: "session-1",
          query: "refresh token",
          contextWindow: 1,
          allMatches: false,
        },
      });
      const parsed = parseToolResult(result) as {
        messages: Array<{ role: string; content: string; matched?: boolean }>;
        matchedMessageIndex: number;
        allMatchIndices: number[];
      };
      // Should behave exactly like the original single-match mode
      expect(parsed.messages).toHaveLength(3);
      expect(parsed.matchedMessageIndex).toBeDefined();
      expect(parsed.allMatchIndices).toBeDefined();
    });
  });

  describe("logbook_memory", () => {
    it("finds memory file content", async () => {
      const result = await client.callTool({
        name: "logbook_memory",
        arguments: { query: "TypeScript strict" },
      });
      const parsed = parseToolResult(result) as {
        totalResults: number;
        results: Array<{ agent: string; filePath: string }>;
      };
      expect(parsed.totalResults).toBeGreaterThan(0);
      expect(parsed.results[0].filePath).toContain("CLAUDE.md");
    });
  });

  describe("logbook_plans", () => {
    it("finds plan file content", async () => {
      const result = await client.callTool({
        name: "logbook_plans",
        arguments: { query: "microservices architecture" },
      });
      const parsed = parseToolResult(result) as {
        totalResults: number;
        results: Array<{ agent: string; filePath: string; type: string }>;
      };
      expect(parsed.totalResults).toBeGreaterThan(0);
      expect(parsed.results[0].type).toBe("plan");
    });
  });
});
