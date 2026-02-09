import type { AgentName } from "../parsers/types.js";

export interface Snippet {
  text: string;
  matchTerms: string[];
}

export interface SearchOptions {
  query: string;
  agent?: AgentName | AgentName[] | "all";
  dateFrom?: Date;
  dateTo?: Date;
  project?: string;
  type?: SearchResult["type"] | SearchResult["type"][];
  fuzzy?: boolean;
  deep?: boolean;
  limit?: number;
  maxSnippets?: number;
  minMessages?: number;
}

export interface SearchResult {
  agent: AgentName;
  sessionId?: string;
  timestamp?: Date;
  project?: string;
  type: "conversation" | "memory" | "plan" | "knowledge";
  score: number;
  matchedText: string;
  snippets: Snippet[];
  matchCount: number;
  messageCount?: number;
  filePath?: string;
  display?: string;
}
