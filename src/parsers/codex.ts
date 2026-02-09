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
import { readJsonl } from "../utils/jsonl.js";
import { isDisplayableMessage } from "../utils/display.js";

interface HistoryEntry {
  session_id?: string;
  ts?: number;
  text?: string;
}

interface SessionEvent {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    id?: string;
    cwd?: string;
    git?: { commit_hash?: string; branch?: string; repository_url?: string };
    cli_version?: string;
    model_provider?: string;
    model?: string;
    role?: string;
    content?: ContentItem[];
    message?: string;
    images?: unknown[];
    effort?: string;
  };
}

interface ContentItem {
  type: string;
  text?: string;
}

export class CodexParser implements AgentParser {
  readonly name: AgentName = "codex";
  readonly displayName = "Codex";
  readonly basePath: string;

  private historyPath: string;
  private sessionsPath: string;

  constructor(customBasePath?: string) {
    this.basePath = customBasePath ?? AGENT_PATHS.codex;
    this.historyPath = join(this.basePath, "history.jsonl");
    this.sessionsPath = join(this.basePath, "sessions");
  }

  async isAvailable(): Promise<boolean> {
    try {
      await stat(this.historyPath);
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(options?: ListSessionsOptions): Promise<SessionSummary[]> {
    const sessionsMap = new Map<string, SessionSummary>();

    for await (const entry of readJsonl<HistoryEntry>(this.historyPath)) {
      if (!entry.session_id) continue;

      const ts = normalizeTimestamp(entry.ts);
      if (!ts) continue;
      if (!isInDateRange(ts, options?.dateFrom, options?.dateTo)) continue;

      if (!sessionsMap.has(entry.session_id)) {
        sessionsMap.set(entry.session_id, {
          agent: "codex",
          sessionId: entry.session_id,
          timestamp: ts,
          display: entry.text,
        });
      }
    }

    let sessions = Array.from(sessionsMap.values());
    sessions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (options?.limit) {
      sessions = sessions.slice(0, options.limit);
    }

    return sessions;
  }

  async getSession(sessionId: string): Promise<SessionContent | null> {
    const filePath = await this.findSessionFile(sessionId);
    if (!filePath) return null;

    const messages: ConversationMessage[] = [];
    let project: string | undefined;
    let sessionTimestamp: Date | undefined;
    const metadata: Record<string, unknown> = {};

    for await (const event of readJsonl<SessionEvent>(filePath)) {
      if (!sessionTimestamp && event.timestamp) {
        sessionTimestamp = normalizeTimestamp(event.timestamp) ?? undefined;
      }

      // Extract session metadata
      if (event.type === "session_meta" && event.payload) {
        project = event.payload.cwd;
        metadata.git = event.payload.git;
        metadata.cliVersion = event.payload.cli_version;
        metadata.modelProvider = event.payload.model_provider;
        continue;
      }

      // Extract user messages from event_msg
      if (event.type === "event_msg" && event.payload?.type === "user_message") {
        const text = event.payload.message;
        if (text) {
          messages.push({
            role: "user",
            content: text,
            timestamp: event.timestamp
              ? (normalizeTimestamp(event.timestamp) ?? undefined)
              : undefined,
          });
        }
        continue;
      }

      // Extract agent conversational messages from event_msg
      if (event.type === "event_msg" && event.payload?.type === "agent_message") {
        const text = event.payload.message;
        if (text) {
          messages.push({
            role: "assistant",
            content: text,
            timestamp: event.timestamp
              ? (normalizeTimestamp(event.timestamp) ?? undefined)
              : undefined,
          });
        }
        continue;
      }

      // Extract assistant messages from response_item
      if (event.type === "response_item" && event.payload?.type === "message") {
        if (event.payload.role === "assistant") {
          const text = event.payload.content
            ?.filter((c) => c.type === "output_text" || c.type === "text")
            .map((c) => c.text ?? "")
            .join("\n");
          if (text) {
            messages.push({
              role: "assistant",
              content: text,
              timestamp: event.timestamp
                ? (normalizeTimestamp(event.timestamp) ?? undefined)
                : undefined,
            });
          }
        }
        continue;
      }
    }

    if (messages.length === 0) return null;

    // Deduplicate consecutive assistant messages with identical content.
    // Real Codex data sometimes logs the same response as both an
    // event_msg/agent_message and a response_item/message.
    const deduped: ConversationMessage[] = [];
    for (const msg of messages) {
      const prev = deduped[deduped.length - 1];
      if (
        prev &&
        msg.role === "assistant" &&
        prev.role === "assistant" &&
        msg.content === prev.content
      ) {
        continue; // Skip duplicate
      }
      deduped.push(msg);
    }

    return {
      agent: "codex",
      sessionId,
      timestamp: sessionTimestamp ?? new Date(0),
      project,
      messages: deduped,
      metadata,
    };
  }

  async *getSearchableDocuments(): AsyncGenerator<SearchableDocument> {
    const indexedSessionIds = new Set<string>();

    // Phase 1: Index full session content from session files
    yield* this.walkSessionTree(this.sessionsPath, indexedSessionIds);

    // Phase 2: Fall back to history.jsonl for sessions without files on disk
    for await (const entry of readJsonl<HistoryEntry>(this.historyPath)) {
      if (!entry.session_id || !entry.text) continue;
      if (indexedSessionIds.has(entry.session_id)) continue;
      const ts = normalizeTimestamp(entry.ts);
      yield {
        id: `codex:history:${entry.session_id}:${entry.ts}`,
        agent: "codex",
        sessionId: entry.session_id,
        timestamp: ts?.getTime(),
        display: entry.text,
        text: entry.text,
        type: "conversation",
      };
    }
  }

  private async *walkSessionTree(
    dirPath: string,
    indexedSessionIds: Set<string>,
  ): AsyncGenerator<SearchableDocument> {
    let entries: string[];
    try {
      entries = await readdir(dirPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);

      if (entry.endsWith(".jsonl")) {
        // Extract session ID from filename: rollout-{ISO}-{sessionId}.jsonl
        const match = entry.match(
          /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/,
        );
        const sessionId = match?.[1];
        if (!sessionId || indexedSessionIds.has(sessionId)) continue;

        // Read full session content
        const parts: string[] = [];
        let project: string | undefined;
        let ts: number | undefined;
        let firstUserMessage: string | undefined;

        try {
          for await (const event of readJsonl<SessionEvent>(fullPath)) {
            if (!ts && event.timestamp) {
              ts = normalizeTimestamp(event.timestamp)?.getTime();
            }
            if (!project && event.type === "session_meta" && event.payload?.cwd) {
              project = event.payload.cwd;
            }
            if (event.type === "event_msg" && event.payload?.type === "user_message" && event.payload.message) {
              if (!firstUserMessage && isDisplayableMessage(event.payload.message)) {
                firstUserMessage = event.payload.message;
              }
              parts.push(event.payload.message);
            }
            if (event.type === "event_msg" && event.payload?.type === "agent_message" && event.payload.message) {
              parts.push(event.payload.message);
            }
            if (event.type === "response_item" && event.payload?.type === "message") {
              const text = event.payload.content
                ?.filter((c) => c.type === "output_text" || c.type === "text")
                .map((c) => c.text ?? "")
                .join("\n");
              if (text) parts.push(text);
            }
          }
        } catch {
          continue; // Corrupted session file — skip
        }

        if (parts.length === 0) continue;

        indexedSessionIds.add(sessionId);
        yield {
          id: `codex:session:${sessionId}`,
          agent: "codex",
          sessionId,
          timestamp: ts,
          project,
          display: firstUserMessage?.slice(0, 200),
          text: parts.join("\n"),
          type: "conversation",
          messageCount: parts.length,
        };
      } else {
        // Recurse into subdirectories (YYYY/MM/DD)
        try {
          const st = await stat(fullPath);
          if (st.isDirectory()) {
            yield* this.walkSessionTree(fullPath, indexedSessionIds);
          }
        } catch {
          continue;
        }
      }
    }
  }

  async getMemoryFiles(): Promise<MemoryFile[]> {
    const files: MemoryFile[] = [];

    // AGENTS.md
    const agentsPath = join(this.basePath, "AGENTS.md");
    await this.tryAddFile(files, agentsPath, "memory");

    // Rules files
    const rulesDir = join(this.basePath, "rules");
    try {
      const entries = await readdir(rulesDir);
      for (const entry of entries) {
        if (entry.endsWith(".md") || entry.endsWith(".rules")) {
          await this.tryAddFile(files, join(rulesDir, entry), "rules");
        }
      }
    } catch {
      // rules dir may not exist
    }

    return files;
  }

  async getPlanFiles(): Promise<MemoryFile[]> {
    return [];
  }

  private async tryAddFile(
    files: MemoryFile[],
    path: string,
    type: MemoryFile["type"],
  ): Promise<void> {
    try {
      const content = await readFile(path, "utf-8");
      if (content.trim()) {
        files.push({ agent: "codex", path, content, type });
      }
    } catch {
      // File doesn't exist
    }
  }

  private async findSessionFile(sessionId: string): Promise<string | null> {
    // Session files are at: sessions/YYYY/MM/DD/rollout-{ISO}-{sessionId}.jsonl
    // Scan the date tree looking for a file containing the session ID.
    try {
      const years = await readdir(this.sessionsPath);
      for (const year of years) {
        const yearPath = join(this.sessionsPath, year);
        let months: string[];
        try { months = await readdir(yearPath); } catch { continue; }
        for (const month of months) {
          const monthPath = join(yearPath, month);
          let days: string[];
          try { days = await readdir(monthPath); } catch { continue; }
          for (const day of days) {
            const dayPath = join(monthPath, day);
            let files: string[];
            try { files = await readdir(dayPath); } catch { continue; }
            for (const file of files) {
              if (file.includes(sessionId) && file.endsWith(".jsonl")) {
                return join(dayPath, file);
              }
            }
          }
        }
      }
    } catch {
      // sessions dir may not exist
    }
    return null;
  }
}
