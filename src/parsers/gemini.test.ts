import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { GeminiParser } from "./gemini.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "test-fixtures", "gemini");

describe("GeminiParser", () => {
  const parser = new GeminiParser(fixturesDir);

  describe("isAvailable", () => {
    it("returns true when tmp directory exists", async () => {
      expect(await parser.isAvailable()).toBe(true);
    });

    it("returns false for nonexistent path", async () => {
      const missing = new GeminiParser("/tmp/nonexistent-gemini-dir");
      expect(await missing.isAvailable()).toBe(false);
    });
  });

  describe("listSessions", () => {
    it("returns sessions from JSON files", async () => {
      const sessions = await parser.listSessions();
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions[0].agent).toBe("gemini");
    });

    it("includes expected session data", async () => {
      const sessions = await parser.listSessions();
      const s1 = sessions.find((s) => s.sessionId === "gemini-session-1");
      expect(s1).toBeDefined();
      expect(s1!.display).toContain("error handling");
      expect(s1!.model).toBe("gemini-2.5-pro");
    });

    it("respects limit", async () => {
      const sessions = await parser.listSessions({ limit: 1 });
      expect(sessions).toHaveLength(1);
    });
  });

  describe("getSession", () => {
    it("returns session content with messages", async () => {
      const session = await parser.getSession("gemini-session-1");
      expect(session).not.toBeNull();
      expect(session!.agent).toBe("gemini");
      expect(session!.sessionId).toBe("gemini-session-1");
      expect(session!.messages).toHaveLength(4);
    });

    it("maps gemini role to assistant", async () => {
      const session = await parser.getSession("gemini-session-1");
      expect(session!.messages[1].role).toBe("assistant");
    });

    it("includes content text", async () => {
      const session = await parser.getSession("gemini-session-1");
      expect(session!.messages[1].content).toContain("error handling patterns");
    });

    it("captures metadata", async () => {
      const session = await parser.getSession("gemini-session-1");
      expect(session!.metadata.projectHash).toBe("abc123");
      expect(session!.metadata.summary).toBe("Discussion about error handling patterns");
    });

    it("returns null for nonexistent session", async () => {
      expect(await parser.getSession("nonexistent-id")).toBeNull();
    });
  });

  describe("getSearchableDocuments", () => {
    it("yields documents from session files and logs", async () => {
      const docs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        docs.push(doc);
      }
      // 1 from session file + 1 from logs.json (cleared session only)
      expect(docs.length).toBeGreaterThanOrEqual(2);
    });

    it("indexes full conversation content including assistant responses", async () => {
      const docs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        if (doc.id.startsWith("gemini:session:")) docs.push(doc);
      }
      const session1 = docs.find((d) => d.sessionId === "gemini-session-1");
      expect(session1).toBeDefined();
      expect(session1!.agent).toBe("gemini");
      expect(session1!.type).toBe("conversation");
      // Verify user messages are included
      expect(session1!.text).toContain("error handling best practices");
      expect(session1!.text).toContain("authentication errors");
      // Verify assistant (gemini) responses are included
      expect(session1!.text).toContain("Use typed errors");
      expect(session1!.text).toContain("return 401 for invalid credentials");
      // Verify messageCount is set for session documents
      expect(session1!.messageCount).toBeGreaterThan(0);
    });

    it("does not duplicate sessions present in both chats/ and logs.json", async () => {
      const docs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        docs.push(doc);
      }
      const session1Docs = docs.filter(
        (d) => d.sessionId === "gemini-session-1",
      );
      expect(session1Docs).toHaveLength(1);
      expect(session1Docs[0].id).toBe("gemini:session:gemini-session-1");
    });

    it("indexes cleared sessions from logs.json", async () => {
      const docs = [];
      for await (const doc of parser.getSearchableDocuments()) {
        docs.push(doc);
      }
      const clearedDoc = docs.find(
        (d) => d.sessionId === "gemini-session-cleared",
      );
      expect(clearedDoc).toBeDefined();
      expect(clearedDoc!.id).toBe("gemini:log:gemini-session-cleared");
      expect(clearedDoc!.text).toContain("CI pipeline");
      expect(clearedDoc!.text).toContain("caching");
    });
  });

  describe("getMemoryFiles", () => {
    it("returns GEMINI.md", async () => {
      const files = await parser.getMemoryFiles();
      expect(files.length).toBeGreaterThanOrEqual(1);
      const geminiMd = files.find((f) => f.path.endsWith("GEMINI.md"));
      expect(geminiMd).toBeDefined();
      expect(geminiMd!.agent).toBe("gemini");
      expect(geminiMd!.type).toBe("memory");
    });
  });

  describe("getPlanFiles", () => {
    it("returns plan files from tmp/{hash}/plans/", async () => {
      const files = await parser.getPlanFiles();
      expect(files.length).toBeGreaterThanOrEqual(1);
      const plan = files.find((f) => f.path.endsWith("refactor-api.md"));
      expect(plan).toBeDefined();
      expect(plan!.agent).toBe("gemini");
      expect(plan!.type).toBe("plan");
      expect(plan!.content).toContain("Centralize error handling");
    });

    it("returns empty for parser with no plans", async () => {
      const noPlanParser = new GeminiParser("/tmp/nonexistent-gemini-dir");
      expect(await noPlanParser.getPlanFiles()).toHaveLength(0);
    });
  });
});
