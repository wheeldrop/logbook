import { describe, it, expect } from "vitest";
import { SearchEngine } from "./engine.js";
import type {
  AgentParser,
  AgentName,
  SessionSummary,
  SessionContent,
  SearchableDocument,
  MemoryFile,
  ListSessionsOptions,
} from "../parsers/types.js";

// --- Mock parser factory ---

function createMockParser(
  name: AgentName,
  displayName: string,
  docs: SearchableDocument[],
  memoryFiles: MemoryFile[] = [],
  planFiles: MemoryFile[] = [],
  sessions: Map<string, SessionContent> = new Map(),
): AgentParser {
  return {
    name,
    displayName,
    basePath: `/mock/${name}`,
    async isAvailable() {
      return true;
    },
    async listSessions(_options?: ListSessionsOptions): Promise<SessionSummary[]> {
      return Array.from(sessions.values()).map((s) => ({
        agent: name,
        sessionId: s.sessionId,
        timestamp: s.timestamp,
        project: s.project,
        display: s.messages[0]?.content,
      }));
    },
    async getSession(sessionId: string): Promise<SessionContent | null> {
      return sessions.get(sessionId) ?? null;
    },
    async *getSearchableDocuments(): AsyncGenerator<SearchableDocument> {
      for (const doc of docs) {
        yield doc;
      }
    },
    async getMemoryFiles(): Promise<MemoryFile[]> {
      return memoryFiles;
    },
    async getPlanFiles(): Promise<MemoryFile[]> {
      return planFiles;
    },
  };
}

// --- Test data ---

const claudeDocs: SearchableDocument[] = [
  {
    id: "claude:history:session-1:1738368000000",
    agent: "claude",
    sessionId: "session-1",
    timestamp: 1738368000000,
    project: "/home/testuser/test-project",
    text: "Help me implement authentication with JWT tokens",
    type: "conversation",
  },
  {
    id: "claude:history:session-2:1738371600000",
    agent: "claude",
    sessionId: "session-2",
    timestamp: 1738371600000,
    project: "/home/testuser/test-project",
    text: "Set up CI/CD pipeline with GitHub Actions",
    type: "conversation",
  },
];

const claudeMemory: MemoryFile[] = [
  {
    agent: "claude",
    path: "/mock/claude/CLAUDE.md",
    content: "Use TypeScript strict mode for all projects. Authentication should use JWT.",
    type: "memory",
  },
];

const claudePlans: MemoryFile[] = [
  {
    agent: "claude",
    path: "/mock/claude/plans/architecture.md",
    content: "Architecture plan: build microservices with authentication gateway",
    type: "plan",
  },
];

const codexDocs: SearchableDocument[] = [
  {
    id: "codex:history:session-3:1738375200000",
    agent: "codex",
    sessionId: "session-3",
    timestamp: 1738375200000,
    project: "/home/testuser/other-project",
    text: "Set up database migration with PostgreSQL",
    type: "conversation",
  },
  {
    id: "codex:history:session-4:1738378800000",
    agent: "codex",
    sessionId: "session-4",
    timestamp: 1738378800000,
    project: "/home/testuser/test-project",
    text: "Implement user authentication flow with OAuth",
    type: "conversation",
  },
];

const geminiDocs: SearchableDocument[] = [
  {
    id: "gemini:session:session-5",
    agent: "gemini",
    sessionId: "session-5",
    timestamp: 1738382400000,
    text: "Explain error handling best practices for Node.js applications",
    type: "conversation",
  },
];

function buildEngine(): SearchEngine {
  const claudeParser = createMockParser("claude", "Claude Code", claudeDocs, claudeMemory, claudePlans);
  const codexParser = createMockParser("codex", "Codex", codexDocs);
  const geminiParser = createMockParser("gemini", "Gemini CLI", geminiDocs);
  return new SearchEngine([claudeParser, codexParser, geminiParser]);
}

describe("SearchEngine", () => {
  describe("basic search", () => {
    it("returns results for matching query", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.sessionId === "session-1")).toBe(true);
    });

    it("returns results sorted by relevance score", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication" });
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("returns empty array for no matches", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "xyznonexistent123" });
      expect(results).toHaveLength(0);
    });
  });

  describe("fuzzy search", () => {
    it("matches with typos when fuzzy is enabled", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "autentication", fuzzy: true });
      expect(results.length).toBeGreaterThan(0);
    });

    it("may not match with typos when fuzzy is disabled", async () => {
      const engine = buildEngine();
      const exactResults = await engine.search({ query: "authentication", fuzzy: false });
      const typoResults = await engine.search({ query: "autentication", fuzzy: false });
      expect(exactResults.length).toBeGreaterThan(0);
      expect(typoResults.length).toBeLessThanOrEqual(exactResults.length);
    });
  });

  describe("agent filter", () => {
    it("filters to a single agent", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication", agent: "claude" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.agent === "claude")).toBe(true);
    });

    it("filters to multiple agents", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication", agent: ["claude", "codex"] });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.agent === "claude" || r.agent === "codex")).toBe(true);
    });

    it("returns results from all agents when agent is 'all'", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication", agent: "all" });
      const agents = new Set(results.map((r) => r.agent));
      expect(agents.has("claude")).toBe(true);
      expect(agents.has("codex")).toBe(true);
    });
  });

  describe("type filter", () => {
    it("filters by single type", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication", type: "memory" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.type === "memory")).toBe(true);
    });

    it("filters by multiple types", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication", type: ["conversation", "memory"] });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.type === "conversation" || r.type === "memory")).toBe(true);
    });

    it("filters by plan type", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "architecture", type: "plan" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.type === "plan")).toBe(true);
    });
  });

  describe("date range filter", () => {
    it("filters with dateFrom", async () => {
      const engine = buildEngine();
      const from = new Date("2025-02-01T02:00:00Z");
      const results = await engine.search({ query: "authentication database error", dateFrom: from });
      expect(results.filter((r) => r.timestamp).every((r) => r.timestamp! >= from)).toBe(true);
    });

    it("filters with dateTo", async () => {
      const engine = buildEngine();
      const to = new Date("2025-02-01T01:30:00Z");
      const results = await engine.search({ query: "authentication database CI pipeline", dateTo: to });
      expect(results.filter((r) => r.timestamp).every((r) => r.timestamp! <= to)).toBe(true);
    });

    it("filters with both dateFrom and dateTo", async () => {
      const engine = buildEngine();
      const from = new Date("2025-02-01T00:30:00Z");
      const to = new Date("2025-02-01T02:30:00Z");
      const results = await engine.search({ query: "authentication database CI pipeline", dateFrom: from, dateTo: to });
      for (const r of results) {
        if (r.timestamp) {
          expect(r.timestamp.getTime()).toBeGreaterThanOrEqual(from.getTime());
          expect(r.timestamp.getTime()).toBeLessThanOrEqual(to.getTime());
        }
      }
    });
  });

  describe("project filter", () => {
    it("filters by project substring", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "database migration", project: "other-project" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => !r.project || r.project.includes("other-project"))).toBe(true);
    });
  });

  describe("limit", () => {
    it("respects max results", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication", limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("result shape", () => {
    it("returns well-formed SearchResult objects", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "database" });
      expect(results.length).toBeGreaterThan(0);
      const r = results[0];
      expect(typeof r.agent).toBe("string");
      expect(typeof r.score).toBe("number");
      expect(typeof r.type).toBe("string");
      expect(typeof r.matchedText).toBe("string");
    });

    it("includes matchedText snippet", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "database" });
      const dbResult = results.find((r) => r.sessionId === "session-3");
      expect(dbResult).toBeDefined();
      expect(dbResult!.matchedText.length).toBeGreaterThan(0);
    });

    it("includes filePath for memory documents", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "TypeScript strict", type: "memory" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].filePath).toBeTruthy();
    });
  });

  describe("multi-snippet extraction", () => {
    it("returns snippets array with at least one snippet", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication" });
      expect(results.length).toBeGreaterThan(0);
      const r = results[0];
      expect(r.snippets).toBeDefined();
      expect(Array.isArray(r.snippets)).toBe(true);
      expect(r.snippets.length).toBeGreaterThanOrEqual(1);
      expect(r.snippets[0].text.length).toBeGreaterThan(0);
    });

    it("matchedText equals first snippet text", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication" });
      for (const r of results) {
        expect(r.matchedText).toBe(r.snippets[0]?.text ?? "");
      }
    });

    it("returns multiple snippets for documents with spread-out matches", async () => {
      // Create a document with the same term appearing far apart
      const longText =
        "The authentication system uses JWT tokens. " +
        "x".repeat(400) +
        " The authentication flow is tested. " +
        "y".repeat(400) +
        " The authentication layer is secure.";
      const docs: SearchableDocument[] = [
        {
          id: "test:multi-snippet",
          agent: "claude",
          sessionId: "multi-1",
          timestamp: 1738368000000,
          text: longText,
          type: "conversation",
        },
      ];
      const parser = createMockParser("claude", "Claude Code", docs);
      const engine = new SearchEngine([parser]);
      const results = await engine.search({ query: "authentication" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippets.length).toBeGreaterThan(1);
    });

    it("respects maxSnippets option", async () => {
      const longText =
        "auth here " + "x".repeat(400) + " auth again " + "x".repeat(400) + " auth more";
      const docs: SearchableDocument[] = [
        {
          id: "test:max-snip",
          agent: "claude",
          sessionId: "max-1",
          timestamp: 1738368000000,
          text: longText,
          type: "conversation",
        },
      ];
      const parser = createMockParser("claude", "Claude Code", docs);
      const engine = new SearchEngine([parser]);
      const results = await engine.search({ query: "auth", maxSnippets: 1 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippets).toHaveLength(1);
    });

    it("deduplicates nearby match positions into one snippet", async () => {
      // Two matches close together should produce one snippet, not two
      const text = "authentication and authorization are both important";
      const docs: SearchableDocument[] = [
        {
          id: "test:dedup",
          agent: "claude",
          sessionId: "dedup-1",
          timestamp: 1738368000000,
          text,
          type: "conversation",
        },
      ];
      const parser = createMockParser("claude", "Claude Code", docs);
      const engine = new SearchEngine([parser]);
      const results = await engine.search({ query: "authentication authorization" });
      expect(results.length).toBeGreaterThan(0);
      // Both terms are within 300 chars, so should be one snippet
      expect(results[0].snippets).toHaveLength(1);
    });

    it("includes matchTerms in snippets", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication" });
      const r = results.find((r) => r.sessionId === "session-1");
      expect(r).toBeDefined();
      expect(r!.snippets[0].matchTerms).toContain("authentication");
    });

    it("returns matchCount for results", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication" });
      for (const r of results) {
        expect(typeof r.matchCount).toBe("number");
        expect(r.matchCount).toBeGreaterThanOrEqual(0);
      }
      // session-1 should have at least one match
      const s1 = results.find((r) => r.sessionId === "session-1");
      expect(s1).toBeDefined();
      expect(s1!.matchCount).toBeGreaterThan(0);
    });

    it("produces fuzzy-only snippets when no exact match", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "autentication" }); // typo
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippets.length).toBeGreaterThanOrEqual(1);
      expect(results[0].snippets[0].text.length).toBeGreaterThan(0);
    });
  });

  describe("messageCount", () => {
    it("passes through messageCount from documents", async () => {
      const docs: SearchableDocument[] = [
        {
          id: "test:msg-count",
          agent: "claude",
          sessionId: "mc-1",
          timestamp: 1738368000000,
          text: "How to set up authentication",
          type: "conversation",
          messageCount: 42,
        },
      ];
      const parser = createMockParser("claude", "Claude Code", docs);
      const engine = new SearchEngine([parser]);
      const results = await engine.search({ query: "authentication" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].messageCount).toBe(42);
    });

    it("messageCount is undefined for docs without it", async () => {
      const engine = buildEngine();
      const results = await engine.search({ query: "authentication" });
      const r = results.find((r) => r.sessionId === "session-1");
      expect(r).toBeDefined();
      expect(r!.messageCount).toBeUndefined();
    });
  });

  describe("minMessages filter", () => {
    it("filters out sessions with fewer messages than minMessages", async () => {
      const docs: SearchableDocument[] = [
        {
          id: "test:short",
          agent: "claude",
          sessionId: "short-1",
          timestamp: 1738368000000,
          text: "authentication setup guide",
          type: "conversation",
          messageCount: 1,
        },
        {
          id: "test:long",
          agent: "claude",
          sessionId: "long-1",
          timestamp: 1738368000000,
          text: "authentication implementation details",
          type: "conversation",
          messageCount: 10,
        },
      ];
      const parser = createMockParser("claude", "Claude Code", docs);
      const engine = new SearchEngine([parser]);

      const all = await engine.search({ query: "authentication" });
      expect(all).toHaveLength(2);

      const filtered = await engine.search({ query: "authentication", minMessages: 5 });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].sessionId).toBe("long-1");
    });

    it("keeps documents without messageCount (memory/plan files)", async () => {
      const docs: SearchableDocument[] = [
        {
          id: "test:no-count",
          agent: "claude",
          sessionId: "nc-1",
          timestamp: 1738368000000,
          text: "authentication guidelines",
          type: "memory",
          // no messageCount
        },
      ];
      const parser = createMockParser("claude", "Claude Code", docs);
      const engine = new SearchEngine([parser]);

      const filtered = await engine.search({ query: "authentication", minMessages: 5 });
      expect(filtered).toHaveLength(1);
    });

    it("has no effect when minMessages is not set", async () => {
      const docs: SearchableDocument[] = [
        {
          id: "test:one-msg",
          agent: "claude",
          sessionId: "one-1",
          timestamp: 1738368000000,
          text: "authentication prompt",
          type: "conversation",
          messageCount: 1,
        },
      ];
      const parser = createMockParser("claude", "Claude Code", docs);
      const engine = new SearchEngine([parser]);

      const results = await engine.search({ query: "authentication" });
      expect(results).toHaveLength(1);
    });
  });
});
