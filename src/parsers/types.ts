export type AgentName = "claude" | "codex" | "gemini" | "antigravity";

export interface SessionSummary {
  agent: AgentName;
  sessionId: string;
  timestamp: Date;
  project?: string;
  display?: string;
  gitBranch?: string;
  model?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: Date;
  toolName?: string;
}

export interface SessionContent {
  agent: AgentName;
  sessionId: string;
  timestamp: Date;
  project?: string;
  messages: ConversationMessage[];
  metadata: Record<string, unknown>;
}

export interface MemoryFile {
  agent: AgentName;
  path: string;
  content: string;
  type: "memory" | "rules" | "plan" | "knowledge" | "todo";
}

export interface SearchableDocument {
  id: string;
  agent: AgentName;
  sessionId?: string;
  timestamp?: number;
  project?: string;
  filePath?: string;
  display?: string;
  text: string;
  type: "conversation" | "memory" | "plan" | "knowledge";
  messageCount?: number;
}

export interface ListSessionsOptions {
  dateFrom?: Date;
  dateTo?: Date;
  project?: string;
  limit?: number;
}

export interface AgentParser {
  readonly name: AgentName;
  readonly displayName: string;
  readonly basePath: string;

  isAvailable(): Promise<boolean>;

  listSessions(options?: ListSessionsOptions): Promise<SessionSummary[]>;

  getSession(sessionId: string): Promise<SessionContent | null>;

  getSearchableDocuments(): AsyncGenerator<SearchableDocument>;

  getMemoryFiles(): Promise<MemoryFile[]>;

  getPlanFiles(): Promise<MemoryFile[]>;
}
