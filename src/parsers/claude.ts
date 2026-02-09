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
  display?: string;
  timestamp?: number;
  project?: string;
  sessionId?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
}

interface SessionEntry {
  type?: string;
  subtype?: string;
  isMeta?: boolean;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  summary?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
}

function extractTextContent(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}

export class ClaudeParser implements AgentParser {
  readonly name: AgentName = "claude";
  readonly displayName = "Claude Code";
  readonly basePath: string;

  private historyPath: string;
  private projectsPath: string;

  constructor(customBasePath?: string) {
    this.basePath = customBasePath ?? AGENT_PATHS.claude;
    this.historyPath = join(this.basePath, "history.jsonl");
    this.projectsPath = join(this.basePath, "projects");
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
      if (!entry.sessionId) continue;

      const ts = normalizeTimestamp(entry.timestamp);
      if (!ts) continue;
      if (!isInDateRange(ts, options?.dateFrom, options?.dateTo)) continue;
      if (options?.project && entry.project && !entry.project.includes(options.project)) continue;

      // Keep the first entry per session (which has the earliest user message)
      if (!sessionsMap.has(entry.sessionId)) {
        sessionsMap.set(entry.sessionId, {
          agent: "claude",
          sessionId: entry.sessionId,
          timestamp: ts,
          project: entry.project,
          display: entry.display,
          gitBranch: entry.gitBranch,
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

    for await (const entry of readJsonl<SessionEntry>(filePath)) {
      // Extract session-level metadata
      if (entry.type === "summary" && entry.summary) {
        metadata.summary = entry.summary;
        continue;
      }

      // Skip non-conversation entries
      if (
        entry.type === "file-history-snapshot" ||
        entry.isMeta ||
        (entry.type === "system" && entry.subtype === "turn_duration")
      ) {
        continue;
      }

      if (!project && entry.cwd) project = entry.cwd;
      if (!sessionTimestamp && entry.timestamp) {
        sessionTimestamp = normalizeTimestamp(entry.timestamp) ?? undefined;
      }

      const role = entry.message?.role;
      if (role !== "user" && role !== "assistant") continue;

      const text = extractTextContent(entry.message?.content);
      if (!text) continue;

      messages.push({
        role: role as "user" | "assistant",
        content: text,
        timestamp: entry.timestamp
          ? (normalizeTimestamp(entry.timestamp) ?? undefined)
          : undefined,
      });
    }

    if (messages.length === 0) return null;

    return {
      agent: "claude",
      sessionId,
      timestamp: sessionTimestamp ?? new Date(0),
      project,
      messages,
      metadata,
    };
  }

  async *getSearchableDocuments(): AsyncGenerator<SearchableDocument> {
    const indexedSessionIds = new Set<string>();

    // Phase 1: Index full session content from session files
    yield* this.getSessionDocuments(indexedSessionIds);

    // Phase 2: Fall back to history.jsonl for sessions without files on disk
    for await (const entry of readJsonl<HistoryEntry>(this.historyPath)) {
      if (!entry.sessionId || !entry.display) continue;
      if (indexedSessionIds.has(entry.sessionId)) continue;
      indexedSessionIds.add(entry.sessionId); // Dedup multiple history entries per session
      const ts = normalizeTimestamp(entry.timestamp);
      yield {
        id: `claude:history:${entry.sessionId}`,
        agent: "claude",
        sessionId: entry.sessionId,
        timestamp: ts?.getTime(),
        project: entry.project,
        display: entry.display,
        text: entry.display,
        type: "conversation",
      };
    }

    // Phase 3: Index subagent sessions (first message only)
    yield* this.getSubagentDocuments();
  }

  private async *getSessionDocuments(
    indexedSessionIds: Set<string>,
  ): AsyncGenerator<SearchableDocument> {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(this.projectsPath);
    } catch {
      return;
    }

    for (const projectDir of projectDirs) {
      const projectPath = join(this.projectsPath, projectDir);
      let entries: string[];
      try {
        entries = await readdir(projectPath);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.endsWith(".jsonl")) continue;
        const filePath = join(projectPath, entry);

        // Skip directories (e.g., session dirs containing subagents/)
        let fileStat;
        try {
          fileStat = await stat(filePath);
        } catch {
          continue;
        }
        if (!fileStat.isFile()) continue;

        const sessionId = entry.slice(0, -".jsonl".length);
        const parts: string[] = [];
        let sessionTimestamp: number | undefined;
        let project: string | undefined;
        let firstUserMessage: string | undefined;

        try {
          for await (const line of readJsonl<SessionEntry>(filePath)) {
            if (!sessionTimestamp && line.timestamp) {
              sessionTimestamp = normalizeTimestamp(line.timestamp)?.getTime();
            }
            if (!project && line.cwd) {
              project = line.cwd;
            }
            const role = line.message?.role;
            if (role !== "user" && role !== "assistant") continue;
            const text = extractTextContent(line.message?.content);
            if (text) {
              if (!firstUserMessage && role === "user" && isDisplayableMessage(text)) {
                firstUserMessage = text;
              }
              parts.push(text);
            }
          }
        } catch {
          continue; // Corrupted session file — skip
        }

        if (parts.length === 0) continue;

        indexedSessionIds.add(sessionId);
        yield {
          id: `claude:session:${sessionId}`,
          agent: "claude",
          sessionId,
          timestamp: sessionTimestamp,
          project,
          display: firstUserMessage?.slice(0, 200),
          text: parts.join("\n"),
          type: "conversation",
          messageCount: parts.length,
        };
      }
    }
  }

  private async *getSubagentDocuments(): AsyncGenerator<SearchableDocument> {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(this.projectsPath);
    } catch {
      return;
    }

    for (const projectDir of projectDirs) {
      const projectPath = join(this.projectsPath, projectDir);

      let sessionEntries: string[];
      try {
        sessionEntries = await readdir(projectPath);
      } catch {
        continue;
      }

      for (const entry of sessionEntries) {
        const subagentsDir = join(projectPath, entry, "subagents");
        let agentFiles: string[];
        try {
          agentFiles = await readdir(subagentsDir);
        } catch {
          continue;
        }

        for (const agentFile of agentFiles) {
          if (!agentFile.startsWith("agent-") || !agentFile.endsWith(".jsonl")) continue;

          const filePath = join(subagentsDir, agentFile);
          const agentId = agentFile.slice("agent-".length, -".jsonl".length);

          // Read only the first entry for Tier 1 indexing
          try {
            for await (const line of readJsonl<SessionEntry>(filePath)) {
              const text = extractTextContent(line.message?.content);
              if (!text) continue;
              const ts = normalizeTimestamp(line.timestamp);
              yield {
                id: `claude:subagent:${entry}:${agentId}`,
                agent: "claude",
                sessionId: entry,
                timestamp: ts?.getTime(),
                project: projectDir.replace(/-/g, "/"),
                filePath,
                text,
                type: "conversation",
                messageCount: 1,
              };
              break; // Only index the first message
            }
          } catch {
            // Corrupted or unreadable subagent file — skip
          }
        }
      }
    }
  }

  async getMemoryFiles(): Promise<MemoryFile[]> {
    const files: MemoryFile[] = [];

    // Global CLAUDE.md
    const globalPath = join(this.basePath, "CLAUDE.md");
    await this.tryAddMemoryFile(files, globalPath, "memory");

    // User-level rules (~/.claude/rules/*.md)
    const rulesDir = join(this.basePath, "rules");
    try {
      const rulesEntries = await readdir(rulesDir);
      for (const entry of rulesEntries) {
        if (entry.endsWith(".md")) {
          await this.tryAddMemoryFile(files, join(rulesDir, entry), "rules");
        }
      }
    } catch {
      // rules dir may not exist
    }

    // Per-project auto-memory (projects/{dir}/memory/*.md)
    try {
      const projectDirs = await readdir(this.projectsPath);
      for (const dir of projectDirs) {
        const memoryDir = join(this.projectsPath, dir, "memory");
        try {
          const memoryEntries = await readdir(memoryDir);
          for (const entry of memoryEntries) {
            if (entry.endsWith(".md")) {
              await this.tryAddMemoryFile(files, join(memoryDir, entry), "memory");
            }
          }
        } catch {
          // memory dir may not exist for this project
        }
      }
    } catch {
      // projects dir may not exist
    }

    return files;
  }

  async getPlanFiles(): Promise<MemoryFile[]> {
    const files: MemoryFile[] = [];
    const plansDir = join(this.basePath, "plans");

    try {
      const entries = await readdir(plansDir);
      for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;
        const planPath = join(plansDir, entry);
        await this.tryAddMemoryFile(files, planPath, "plan");
      }
    } catch {
      // plans dir may not exist
    }

    return files;
  }

  private async tryAddMemoryFile(
    files: MemoryFile[],
    path: string,
    type: MemoryFile["type"],
  ): Promise<void> {
    try {
      const content = await readFile(path, "utf-8");
      if (content.trim()) {
        files.push({ agent: "claude", path, content, type });
      }
    } catch {
      // File doesn't exist — that's fine
    }
  }

  private async findSessionFile(sessionId: string): Promise<string | null> {
    // Session files are at: projects/{encoded-path}/{sessionId}.jsonl
    // We need to search across all project directories.
    try {
      const projectDirs = await readdir(this.projectsPath);
      for (const dir of projectDirs) {
        const candidatePath = join(this.projectsPath, dir, `${sessionId}.jsonl`);
        try {
          await stat(candidatePath);
          return candidatePath;
        } catch {
          // Not in this directory
        }
      }
    } catch {
      // projects dir may not exist
    }
    return null;
  }
}
