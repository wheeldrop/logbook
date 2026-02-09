import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ClaudeParser } from "./claude.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "test-fixtures", "claude");

describe("ClaudeParser", () => {
  const parser = new ClaudeParser(fixturesDir);

  describe("isAvailable", () => {
    it("returns true when history.jsonl exists", async () => {
      expect(await parser.isAvailable()).toBe(true);
    });

    it("returns false for nonexistent path", async () => {
      const missing = new ClaudeParser("/tmp/nonexistent-claude-dir");
      expect(await missing.isAvailable()).toBe(false);
    });
  });

  describe("listSessions", () => {
    it("returns unique sessions sorted by recency", async () => {
      const sessions = await parser.listSessions();
      expect(sessions).toHaveLength(3);
      expect(sessions[0].agent).toBe("claude");
      // Most recent first
      expect(sessions[0].timestamp.getTime()).toBeGreaterThanOrEqual(sessions[1].timestamp.getTime());
      expect(sessions[1].timestamp.getTime()).toBeGreaterThanOrEqual(sessions[2].timestamp.getTime());
    });

    it("includes expected session data", async () => {
      const sessions = await parser.listSessions();
      const s1 = sessions.find((s) => s.sessionId === "test-session-1");
      expect(s1).toBeDefined();
      expect(s1!.display).toBe("Help me with authentication");
      expect(s1!.project).toBe("/home/testuser/test-project");
      expect(s1!.gitBranch).toBe("main");
    });

    it("filters by date range", async () => {
      const from = new Date(1738371600000); // session-2 timestamp
      const sessions = await parser.listSessions({ dateFrom: from });
      expect(sessions.length).toBeGreaterThanOrEqual(2);
      expect(sessions.every((s) => s.timestamp >= from)).toBe(true);
    });

    it("respects limit", async () => {
      const sessions = await parser.listSessions({ limit: 1 });
      expect(sessions).toHaveLength(1);
    });
  });

  describe("getSession", () => {
    it("returns session content with messages", async () => {
      const session = await parser.getSession("test-session-1");
      expect(session).not.toBeNull();
      expect(session!.agent).toBe("claude");
      expect(session!.sessionId).toBe("test-session-1");
      expect(session!.project).toBe("/home/testuser/test-project");
      expect(session!.messages).toHaveLength(4);
    });

    it("extracts correct roles", async () => {
      const session = await parser.getSession("test-session-1");
      expect(session!.messages[0].role).toBe("user");
      expect(session!.messages[1].role).toBe("assistant");
    });

    it("extracts text from content blocks", async () => {
      const session = await parser.getSession("test-session-1");
      expect(session!.messages[1].content).toContain("JWT tokens");
    });

    it("captures summary in metadata", async () => {
      const session = await parser.getSession("test-session-1");
      expect(session!.metadata.summary).toBe("Implemented JWT authentication with refresh token support");
    });

    it("returns null for nonexistent session", async () => {
      expect(await parser.getSession("nonexistent-id")).toBeNull();
    });
  });

  describe("getSearchableDocuments", () => {
    it("yields session, history fallback, and subagent documents", async () => {
      const docs: unknown[] = [];
      for await (const doc of parser.getSearchableDocuments()) {
        docs.push(doc);
      }
      // 1 session doc (test-session-1) + 2 history fallbacks (session-2, session-3) + 2 subagent files
      expect(docs.length).toBeGreaterThanOrEqual(5);
    });

    it("indexes full session content including assistant responses", async () => {
      const docs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        docs.push(doc);
      }
      const sessionDoc = docs.find((d) => d.id === "claude:session:test-session-1");
      expect(sessionDoc).toBeDefined();
      expect(sessionDoc!.agent).toBe("claude");
      expect(sessionDoc!.type).toBe("conversation");
      // Verify user messages are included
      expect(sessionDoc!.text).toContain("authentication");
      // Verify assistant responses are included
      expect(sessionDoc!.text).toContain("JWT tokens");
      expect(sessionDoc!.text).toContain("refresh token");
      // Verify messageCount is set for session documents
      expect(sessionDoc!.messageCount).toBeGreaterThan(0);
    });

    it("falls back to history entries for sessions without files", async () => {
      const docs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        docs.push(doc);
      }
      // test-session-2 has no session file — should fall back to history entry
      const historyDoc = docs.find((d) => d.id === "claude:history:test-session-2");
      expect(historyDoc).toBeDefined();
      expect(historyDoc!.text).toBe("Set up CI/CD pipeline");
      expect(historyDoc!.agent).toBe("claude");
      expect(historyDoc!.type).toBe("conversation");
      // History fallback has no messageCount
      expect(historyDoc!.messageCount).toBeUndefined();
    });

    it("does not duplicate sessions present in both files and history", async () => {
      const docs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        docs.push(doc);
      }
      // test-session-1 has both a session file and history entries — should only appear once
      const session1Docs = docs.filter((d) => d.sessionId === "test-session-1" && !d.id.includes("subagent"));
      expect(session1Docs).toHaveLength(1);
      expect(session1Docs[0].id).toBe("claude:session:test-session-1");
    });

    it("includes subagent documents", async () => {
      const docs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        if (doc.id.startsWith("claude:subagent:")) {
          docs.push(doc);
        }
      }
      expect(docs).toHaveLength(2);
    });

    it("subagent documents have correct shape", async () => {
      const subagentDocs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        if (doc.id.startsWith("claude:subagent:")) {
          subagentDocs.push(doc);
        }
      }
      const authDoc = subagentDocs.find((d) => d.text.includes("authentication middleware"));
      expect(authDoc).toBeDefined();
      expect(authDoc!.agent).toBe("claude");
      expect(authDoc!.type).toBe("conversation");
      expect(authDoc!.sessionId).toBe("session-1");
      expect(authDoc!.filePath).toContain("agent-abc1234.jsonl");
    });

    it("subagent documents index only first message", async () => {
      const subagentDocs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        if (doc.id.startsWith("claude:subagent:")) {
          subagentDocs.push(doc);
        }
      }
      // Each subagent should produce exactly 1 document (from first message)
      const ids = subagentDocs.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("getMemoryFiles", () => {
    it("returns CLAUDE.md", async () => {
      const files = await parser.getMemoryFiles();
      const claudeMd = files.find((f) => f.path.endsWith("CLAUDE.md") && !f.path.includes("memory/"));
      expect(claudeMd).toBeDefined();
      expect(claudeMd!.agent).toBe("claude");
      expect(claudeMd!.type).toBe("memory");
      expect(claudeMd!.content).toContain("TypeScript strict mode");
    });

    it("returns auto-memory files from projects/{dir}/memory/", async () => {
      const files = await parser.getMemoryFiles();
      const autoMemory = files.find((f) => f.path.includes("memory/MEMORY.md"));
      expect(autoMemory).toBeDefined();
      expect(autoMemory!.agent).toBe("claude");
      expect(autoMemory!.type).toBe("memory");
      expect(autoMemory!.content).toContain("Drizzle ORM");
    });

    it("returns user rules from rules/*.md", async () => {
      const files = await parser.getMemoryFiles();
      const rules = files.filter((f) => f.type === "rules");
      expect(rules.length).toBeGreaterThanOrEqual(1);
      const codingStandards = rules.find((f) => f.path.endsWith("coding-standards.md"));
      expect(codingStandards).toBeDefined();
      expect(codingStandards!.content).toContain("strict TypeScript");
    });

    it("handles missing rules and memory dirs gracefully", async () => {
      const sparse = new ClaudeParser("/tmp/nonexistent-claude-dir");
      const files = await sparse.getMemoryFiles();
      expect(files).toHaveLength(0);
    });
  });

  describe("getPlanFiles", () => {
    it("returns only .md files from plans directory", async () => {
      const files = await parser.getPlanFiles();
      expect(files.length).toBeGreaterThanOrEqual(1);
      const arch = files.find((f) => f.path.endsWith("architecture.md"));
      expect(arch).toBeDefined();
      expect(arch!.type).toBe("plan");
      expect(arch!.content).toContain("microservices");
    });

    it("skips non-.md files in plans directory", async () => {
      const files = await parser.getPlanFiles();
      expect(files.every((f) => f.path.endsWith(".md"))).toBe(true);
    });

    it("returns empty for parser with no plans directory", async () => {
      const noPlanParser = new ClaudeParser("/tmp/nonexistent-claude-dir");
      expect(await noPlanParser.getPlanFiles()).toHaveLength(0);
    });
  });
});
