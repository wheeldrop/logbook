import { readdir, stat, readFile } from "fs/promises";
import { join } from "path";
import type {
  AgentParser,
  AgentName,
  SessionSummary,
  SessionContent,
  ConversationMessage,
  SearchableDocument,
  MemoryFile,
  ListSessionsOptions,
} from "./types.js";
import { AGENT_PATHS } from "../utils/paths.js";
import { normalizeTimestamp, isInDateRange } from "../utils/time.js";
import { isDisplayableMessage } from "../utils/display.js";

interface GeminiSession {
  sessionId: string;
  projectHash: string;
  startTime: string;
  lastUpdated: string;
  messages: GeminiMessage[];
  summary?: string;
  directories?: string[];
}

interface GeminiMessage {
  id: string;
  timestamp: string;
  type: "user" | "gemini" | "info" | "error" | "warning";
  content: string | unknown[];
  toolCalls?: unknown[];
  thoughts?: unknown[];
  model?: string;
  tokens?: { input?: number; output?: number; total?: number };
}

interface LogEntry {
  sessionId: string;
  messageId: number;
  type: string;
  message: string;
  timestamp: string;
}

export class GeminiParser implements AgentParser {
  readonly name: AgentName = "gemini";
  readonly displayName = "Gemini CLI";
  readonly basePath: string;

  private tmpPath: string;

  constructor(customBasePath?: string) {
    this.basePath = customBasePath ?? AGENT_PATHS.gemini;
    this.tmpPath = join(this.basePath, "tmp");
  }

  async isAvailable(): Promise<boolean> {
    try {
      await stat(this.tmpPath);
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(options?: ListSessionsOptions): Promise<SessionSummary[]> {
    const sessions: SessionSummary[] = [];

    for await (const { session } of this.iterateSessionFiles()) {
      const ts = normalizeTimestamp(session.startTime);
      if (!ts) continue;
      if (!isInDateRange(ts, options?.dateFrom, options?.dateTo)) continue;

      // Extract first user message as display
      const firstUser = session.messages?.find((m) => m.type === "user");
      const display =
        session.summary ||
        (typeof firstUser?.content === "string"
          ? firstUser.content.slice(0, 200)
          : undefined);

      sessions.push({
        agent: "gemini",
        sessionId: session.sessionId,
        timestamp: ts,
        display,
        model: session.messages?.find((m) => m.type === "gemini")?.model,
      });
    }

    sessions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (options?.limit) {
      return sessions.slice(0, options.limit);
    }
    return sessions;
  }

  async getSession(sessionId: string): Promise<SessionContent | null> {
    for await (const { session } of this.iterateSessionFiles()) {
      if (session.sessionId !== sessionId) continue;

      const messages: ConversationMessage[] = [];
      for (const m of session.messages ?? []) {
        if (m.type !== "user" && m.type !== "gemini") continue;
        const text = typeof m.content === "string" ? m.content : "";
        if (!text) continue;
        messages.push({
          role: m.type === "user" ? "user" : "assistant",
          content: text,
          timestamp: normalizeTimestamp(m.timestamp) ?? undefined,
        });
      }

      if (messages.length === 0) return null;

      return {
        agent: "gemini",
        sessionId,
        timestamp: normalizeTimestamp(session.startTime) ?? new Date(0),
        project: session.directories?.[0],
        messages,
        metadata: {
          projectHash: session.projectHash,
          summary: session.summary,
        },
      };
    }
    return null;
  }

  async *getSearchableDocuments(): AsyncGenerator<SearchableDocument> {
    const yieldedSessionIds = new Set<string>();

    // Yield full conversation content from session files
    for await (const { session, filePath } of this.iterateSessionFiles()) {
      const ts = normalizeTimestamp(session.startTime);

      // Concatenate all user and assistant messages for full-text indexing
      const messageParts = (session.messages ?? [])
        .filter((m) => m.type === "user" || m.type === "gemini")
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .filter(Boolean);
      const allText = messageParts.join("\n");

      if (allText) {
        const firstDisplayableUser = session.messages?.find(
          (m) =>
            m.type === "user" &&
            typeof m.content === "string" &&
            isDisplayableMessage(m.content),
        );
        const displayText =
          session.summary ||
          (typeof firstDisplayableUser?.content === "string"
            ? firstDisplayableUser.content.slice(0, 200)
            : undefined);

        yieldedSessionIds.add(session.sessionId);
        yield {
          id: `gemini:session:${session.sessionId}`,
          agent: "gemini",
          sessionId: session.sessionId,
          timestamp: ts?.getTime(),
          filePath,
          display: displayText,
          text: allText,
          type: "conversation",
          messageCount: messageParts.length,
        };
      }
    }

    // Yield from logs.json (catches /clear'd sessions not in chats/)
    yield* this.getLogDocuments(yieldedSessionIds);
  }

  private async *getLogDocuments(
    excludeSessionIds: Set<string>,
  ): AsyncGenerator<SearchableDocument> {
    let projectHashes: string[];
    try {
      projectHashes = await readdir(this.tmpPath);
    } catch {
      return;
    }

    for (const hash of projectHashes) {
      const logsPath = join(this.tmpPath, hash, "logs.json");
      let entries: LogEntry[];
      try {
        const raw = await readFile(logsPath, "utf-8");
        entries = JSON.parse(raw) as LogEntry[];
      } catch {
        continue;
      }

      // Group by sessionId
      const bySession = new Map<string, LogEntry[]>();
      for (const entry of entries) {
        if (!entry.sessionId || !entry.message) continue;
        if (excludeSessionIds.has(entry.sessionId)) continue;
        let group = bySession.get(entry.sessionId);
        if (!group) {
          group = [];
          bySession.set(entry.sessionId, group);
        }
        group.push(entry);
      }

      for (const [sessionId, logs] of bySession) {
        // Sort by messageId to preserve order
        logs.sort((a, b) => (a.messageId ?? 0) - (b.messageId ?? 0));
        const text = logs.map((l) => l.message).join("\n");
        const ts = normalizeTimestamp(logs[0].timestamp);
        yield {
          id: `gemini:log:${sessionId}`,
          agent: "gemini",
          sessionId,
          timestamp: ts?.getTime(),
          display: logs[0].message?.slice(0, 200),
          text,
          type: "conversation",
          messageCount: logs.length,
        };
      }
    }
  }

  async getMemoryFiles(): Promise<MemoryFile[]> {
    const files: MemoryFile[] = [];
    const globalPath = join(this.basePath, "GEMINI.md");
    try {
      const content = await readFile(globalPath, "utf-8");
      if (content.trim()) {
        files.push({ agent: "gemini", path: globalPath, content, type: "memory" });
      }
    } catch {
      // File doesn't exist
    }
    return files;
  }

  async getPlanFiles(): Promise<MemoryFile[]> {
    const files: MemoryFile[] = [];

    let projectHashes: string[];
    try {
      projectHashes = await readdir(this.tmpPath);
    } catch {
      return files;
    }

    for (const hash of projectHashes) {
      const plansDir = join(this.tmpPath, hash, "plans");
      let planEntries: string[];
      try {
        planEntries = await readdir(plansDir);
      } catch {
        continue;
      }
      for (const entry of planEntries) {
        if (!entry.endsWith(".md")) continue;
        const planPath = join(plansDir, entry);
        try {
          const content = await readFile(planPath, "utf-8");
          if (content.trim()) {
            files.push({ agent: "gemini", path: planPath, content, type: "plan" });
          }
        } catch {
          // Skip unreadable plan files
        }
      }
    }

    return files;
  }

  private async *iterateSessionFiles(): AsyncGenerator<{
    session: GeminiSession;
    filePath: string;
  }> {
    let projectHashes: string[];
    try {
      projectHashes = await readdir(this.tmpPath);
    } catch {
      return;
    }

    for (const hash of projectHashes) {
      const chatsDir = join(this.tmpPath, hash, "chats");
      let chatFiles: string[];
      try {
        chatFiles = await readdir(chatsDir);
      } catch {
        continue;
      }

      for (const file of chatFiles) {
        if (!file.startsWith("session-") || !file.endsWith(".json")) continue;
        const filePath = join(chatsDir, file);
        try {
          const raw = await readFile(filePath, "utf-8");
          const session = JSON.parse(raw) as GeminiSession;
          if (session.sessionId) {
            yield { session, filePath };
          }
        } catch {
          // Skip malformed files
        }
      }
    }
  }
}
