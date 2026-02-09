import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { CodexParser } from "./codex.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "test-fixtures", "codex");

describe("CodexParser", () => {
  const parser = new CodexParser(fixturesDir);

  describe("isAvailable", () => {
    it("returns true when history.jsonl exists", async () => {
      expect(await parser.isAvailable()).toBe(true);
    });

    it("returns false for nonexistent path", async () => {
      const missing = new CodexParser("/tmp/nonexistent-codex-dir");
      expect(await missing.isAvailable()).toBe(false);
    });
  });

  describe("listSessions", () => {
    it("returns sessions sorted by recency", async () => {
      const sessions = await parser.listSessions();
      expect(sessions).toHaveLength(3);
      expect(sessions[0].timestamp.getTime()).toBeGreaterThanOrEqual(sessions[1].timestamp.getTime());
    });

    it("includes expected session data", async () => {
      const sessions = await parser.listSessions();
      const s1 = sessions.find((s) => s.sessionId === "codex-session-1");
      expect(s1).toBeDefined();
      expect(s1!.display).toBe("Set up database migration");
    });

    it("respects limit", async () => {
      const sessions = await parser.listSessions({ limit: 1 });
      expect(sessions).toHaveLength(1);
    });
  });

  describe("getSession", () => {
    it("returns session content with messages", async () => {
      const session = await parser.getSession("codex-session-1");
      expect(session).not.toBeNull();
      expect(session!.agent).toBe("codex");
      expect(session!.sessionId).toBe("codex-session-1");
      expect(session!.messages).toHaveLength(5);
    });

    it("extracts correct roles", async () => {
      const session = await parser.getSession("codex-session-1");
      expect(session!.messages[0].role).toBe("user");
      expect(session!.messages[1].role).toBe("assistant");
    });

    it("captures git metadata", async () => {
      const session = await parser.getSession("codex-session-1");
      expect(session!.metadata.git).toBeDefined();
    });

    it("includes agent_message events as assistant messages", async () => {
      const session = await parser.getSession("codex-session-1");
      const agentMsgs = session!.messages.filter(
        (m) => m.role === "assistant" && m.content.includes("Migration files created"),
      );
      expect(agentMsgs).toHaveLength(1);
      expect(agentMsgs[0].timestamp).toBeDefined();
    });

    it("returns null for nonexistent session", async () => {
      expect(await parser.getSession("nonexistent-id")).toBeNull();
    });

    it("deduplicates consecutive identical assistant messages", async () => {
      // codex-session-dup has the same assistant text in both event_msg/agent_message
      // and response_item/message — should be deduplicated to one
      const session = await parser.getSession("codex-session-dup");
      expect(session).not.toBeNull();
      const assistantMsgs = session!.messages.filter((m) => m.role === "assistant");
      // 2 unique assistant messages, not 3 (the duplicate should be removed)
      expect(assistantMsgs).toHaveLength(2);
      // Verify the messages are the correct unique ones
      expect(assistantMsgs[0].content).toContain("null check");
      expect(assistantMsgs[1].content).toContain("login flow works");
    });
  });

  describe("getSearchableDocuments", () => {
    it("yields session and history fallback documents", async () => {
      const docs: unknown[] = [];
      for await (const doc of parser.getSearchableDocuments()) {
        docs.push(doc);
      }
      // 1 session doc (codex-session-1) + 2 history fallbacks (session-2, session-3)
      expect(docs.length).toBeGreaterThanOrEqual(3);
    });

    it("indexes full session content including assistant responses", async () => {
      const docs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        docs.push(doc);
      }
      const sessionDoc = docs.find((d) => d.id === "codex:session:codex-session-1");
      expect(sessionDoc).toBeDefined();
      expect(sessionDoc!.agent).toBe("codex");
      expect(sessionDoc!.type).toBe("conversation");
      // Verify user messages are included
      expect(sessionDoc!.text).toContain("database migration");
      // Verify assistant responses are included
      expect(sessionDoc!.text).toContain("migration files");
      expect(sessionDoc!.text).toContain("indexing on email");
      // Verify agent_message content is included
      expect(sessionDoc!.text).toContain("Migration files created successfully");
      // Verify messageCount is set for session documents
      expect(sessionDoc!.messageCount).toBeGreaterThan(0);
    });

    it("falls back to history for sessions without files", async () => {
      const docs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        docs.push(doc);
      }
      const historyDoc = docs.find((d) => d.id?.includes("codex:history:codex-session-2"));
      expect(historyDoc).toBeDefined();
      expect(historyDoc!.text).toBe("Implement user authentication flow");
    });

    it("does not duplicate sessions present in both files and history", async () => {
      const docs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        docs.push(doc);
      }
      const session1Docs = docs.filter((d) => d.sessionId === "codex-session-1");
      expect(session1Docs).toHaveLength(1);
      expect(session1Docs[0].id).toBe("codex:session:codex-session-1");
    });

    it("documents have correct agent and type", async () => {
      for await (const doc of parser.getSearchableDocuments()) {
        expect(doc.agent).toBe("codex");
        expect(doc.type).toBe("conversation");
        break;
      }
    });
  });

  describe("getMemoryFiles", () => {
    it("returns AGENTS.md", async () => {
      const files = await parser.getMemoryFiles();
      expect(files.length).toBeGreaterThanOrEqual(1);
      const agentsMd = files.find((f) => f.path.endsWith("AGENTS.md"));
      expect(agentsMd).toBeDefined();
      expect(agentsMd!.agent).toBe("codex");
      expect(agentsMd!.type).toBe("memory");
    });

    it("returns .md and .rules files from rules directory", async () => {
      const files = await parser.getMemoryFiles();
      const rulesFiles = files.filter((f) => f.type === "rules");
      expect(rulesFiles.length).toBeGreaterThanOrEqual(2);
      expect(rulesFiles.some((f) => f.path.endsWith(".md"))).toBe(true);
      expect(rulesFiles.some((f) => f.path.endsWith(".rules"))).toBe(true);
    });

    it("skips non-.md/.rules files in rules directory", async () => {
      const files = await parser.getMemoryFiles();
      const rulesFiles = files.filter((f) => f.type === "rules");
      expect(rulesFiles.every((f) => f.path.endsWith(".md") || f.path.endsWith(".rules"))).toBe(true);
    });
  });

  describe("getPlanFiles", () => {
    it("returns empty array", async () => {
      expect(await parser.getPlanFiles()).toHaveLength(0);
    });
  });
});
