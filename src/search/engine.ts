import MiniSearch from "minisearch";
import type { AgentParser, SearchableDocument, AgentName } from "../parsers/types.js";
import type { SearchOptions, SearchResult, Snippet } from "./types.js";
import { TOKENIZER_RE, levenshteinDistance } from "./tokenizer.js";

const MAX_MATCH_POSITIONS = 100;

/**
 * Tiered search engine backed by MiniSearch.
 *
 * Tier 1 (fast): History entries + memory/plan files. Built on first search.
 * Tier 2 (deep): Full session content. Built lazily when deep=true is requested.
 */
export class SearchEngine {
  private tier1Index: MiniSearch<SearchableDocument> | null = null;
  private tier1Docs: SearchableDocument[] = [];
  private tier1Built = false;

  private parsers: AgentParser[] = [];

  constructor(parsers: AgentParser[]) {
    this.parsers = parsers;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    if (!this.tier1Built) {
      await this.buildTier1();
    }

    const index = this.tier1Index!;

    const searchOptions: Parameters<typeof index.search>[1] = {
      fuzzy: options.fuzzy !== false ? 0.2 : false,
      prefix: true,
      boost: { text: 2, project: 1 },
    };

    // Agent filter (supports single agent, array of agents, or "all")
    if (options.agent && options.agent !== "all") {
      const agents = Array.isArray(options.agent) ? options.agent : [options.agent];
      searchOptions.filter = (result) =>
        agents.includes(result.agent as AgentName);
    }

    let results = index.search(options.query, searchOptions);

    // Post-filter by date range
    if (options.dateFrom || options.dateTo) {
      const from = options.dateFrom?.getTime();
      const to = options.dateTo?.getTime();
      results = results.filter((r) => {
        const ts = r.timestamp as number | undefined;
        if (!ts) return true; // Include results without timestamps
        if (from && ts < from) return false;
        if (to && ts > to) return false;
        return true;
      });
    }

    // Post-filter by document type
    if (options.type) {
      const allowedTypes = Array.isArray(options.type) ? options.type : [options.type];
      results = results.filter((r) => {
        const docType = r.type as string | undefined;
        const doc = docType ? undefined : this.tier1Docs.find((d) => d.id === r.id);
        const resolvedType = docType ?? doc?.type ?? "conversation";
        return allowedTypes.includes(resolvedType as SearchResult["type"]);
      });
    }

    // Post-filter by project substring
    if (options.project) {
      const projectFilter = options.project.toLowerCase();
      results = results.filter((r) => {
        const proj = r.project as string | undefined;
        return !proj || proj.toLowerCase().includes(projectFilter);
      });
    }

    // Post-filter by minimum message count
    if (options.minMessages) {
      const min = options.minMessages;
      results = results.filter((r) => {
        const doc = this.tier1Docs.find((d) => d.id === r.id);
        const mc = doc?.messageCount;
        // Keep results without messageCount (memory/plan files) or with enough messages
        return mc === undefined || mc >= min;
      });
    }

    const limit = options.limit ?? 20;
    const maxSnippets = options.maxSnippets ?? 3;

    // Map to SearchResult with length-normalized scores, then re-sort.
    // Long documents (memory/plan files) accumulate high raw TF-IDF scores
    // from repeated term occurrences, burying short but specific matches
    // like user prompts. This dampening levels the playing field.
    const mapped = results.map((r) => {
      const doc = this.tier1Docs.find((d) => d.id === r.id);
      const textLen = doc?.text?.length ?? 0;
      const lengthPenalty = textLen > 500 ? Math.log2(textLen / 500) : 0;
      const { snippets, matchCount } = this.extractSnippets(
        doc?.text ?? "",
        options.query,
        maxSnippets,
      );
      return {
        agent: (r.agent ?? doc?.agent ?? "claude") as AgentName,
        sessionId: (r.sessionId ?? doc?.sessionId) as string | undefined,
        timestamp: r.timestamp ? new Date(r.timestamp as number) : undefined,
        project: r.project as string | undefined,
        filePath: (r.filePath ?? doc?.filePath) as string | undefined,
        type: (r.type ?? doc?.type ?? "conversation") as SearchResult["type"],
        score: r.score / (1 + lengthPenalty * 0.5),
        matchedText: snippets[0]?.text ?? "",
        snippets,
        matchCount,
        messageCount: doc?.messageCount,
        display: (r.display ?? doc?.display) as string | undefined,
      };
    });

    mapped.sort((a, b) => b.score - a.score);
    return mapped.slice(0, limit);
  }

  private async buildTier1(): Promise<void> {
    console.error("Building tier-1 search index...");
    const startTime = Date.now();

    const index = new MiniSearch<SearchableDocument>({
      fields: ["text", "project"],
      storeFields: ["agent", "sessionId", "timestamp", "project", "type", "filePath", "display"],
      idField: "id",
      tokenize: (text) => {
        return text
          .toLowerCase()
          .split(TOKENIZER_RE)
          .filter((t) => t.length > 1);
      },
    });

    const docs: SearchableDocument[] = [];

    for (const parser of this.parsers) {
      if (!(await parser.isAvailable())) continue;

      try {
        // Index conversation history (fast — reads history.jsonl only)
        for await (const doc of parser.getSearchableDocuments()) {
          docs.push(doc);
        }

        // Index memory files
        for (const mem of await parser.getMemoryFiles()) {
          docs.push({
            id: `${parser.name}:memory:${mem.path}`,
            agent: parser.name,
            filePath: mem.path,
            text: mem.content,
            type: "memory",
          });
        }

        // Index plan files
        for (const plan of await parser.getPlanFiles()) {
          docs.push({
            id: `${parser.name}:plan:${plan.path}`,
            agent: parser.name,
            filePath: plan.path,
            text: plan.content,
            type: "plan",
          });
        }
      } catch (err) {
        console.error(`Error indexing ${parser.displayName}:`, err);
      }
    }

    // Deduplicate by id (in case of duplicate entries)
    const seen = new Set<string>();
    const uniqueDocs = docs.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });

    index.addAll(uniqueDocs);
    this.tier1Index = index;
    this.tier1Docs = uniqueDocs;
    this.tier1Built = true;

    console.error(
      `Tier-1 index built: ${uniqueDocs.length} documents in ${Date.now() - startTime}ms`,
    );
  }

  /**
   * Find all positions where any query word matches in the text.
   * Returns sorted, deduplicated positions and the total match count.
   */
  private findAllMatchPositions(
    lowerText: string,
    queryWords: string[],
  ): { positions: number[]; matchCount: number; positionTerms: Map<number, string[]> } {
    const positions: number[] = [];
    const positionTerms = new Map<number, string[]>();

    const addPosition = (pos: number, term: string) => {
      positions.push(pos);
      const existing = positionTerms.get(pos);
      if (existing) {
        if (!existing.includes(term)) existing.push(term);
      } else {
        positionTerms.set(pos, [term]);
      }
    };

    // Phase 1: Find all exact substring matches
    for (const word of queryWords) {
      let searchFrom = 0;
      while (positions.length < MAX_MATCH_POSITIONS) {
        const pos = lowerText.indexOf(word, searchFrom);
        if (pos === -1) break;
        addPosition(pos, word);
        searchFrom = pos + word.length;
      }
    }

    // Phase 2: If no exact matches, fall back to Levenshtein fuzzy scan
    if (positions.length === 0) {
      const textWords = lowerText.split(TOKENIZER_RE);
      let cursor = 0;
      for (const tw of textWords) {
        if (positions.length >= MAX_MATCH_POSITIONS) break;
        const twStart = lowerText.indexOf(tw, cursor);
        if (twStart === -1) continue;
        cursor = twStart + tw.length;
        for (const qw of queryWords) {
          if (Math.abs(tw.length - qw.length) > 2) continue;
          const dist = levenshteinDistance(tw, qw);
          if (dist <= 2) {
            addPosition(twStart, qw);
          }
        }
      }
    }

    // Sort and deduplicate positions
    const unique = [...new Set(positions)].sort((a, b) => a - b);
    return { positions: unique, matchCount: positions.length, positionTerms };
  }

  /**
   * Extract multiple non-overlapping snippets from the text, centered on
   * match positions. Returns up to maxSnippets snippets with the query
   * terms that matched in each.
   */
  private extractSnippets(
    text: string,
    query: string,
    maxSnippets = 3,
    contextChars = 150,
  ): { snippets: Snippet[]; matchCount: number } {
    if (!text) return { snippets: [], matchCount: 0 };

    const lowerText = text.toLowerCase();
    const queryWords = query
      .toLowerCase()
      .split(TOKENIZER_RE)
      .filter((w) => w.length > 1);

    const { positions, matchCount, positionTerms } = this.findAllMatchPositions(
      lowerText,
      queryWords,
    );

    // No matches at all — return start of text as fallback
    if (positions.length === 0) {
      const fallbackText =
        text.slice(0, contextChars * 2).trim() +
        (text.length > contextChars * 2 ? "..." : "");
      return {
        snippets: [{ text: fallbackText, matchTerms: [] }],
        matchCount: 0,
      };
    }

    // Greedily select non-overlapping snippet centers
    const minSeparation = contextChars * 2;
    const selectedPositions: number[] = [];
    let lastSelected = -Infinity;

    for (const pos of positions) {
      if (pos - lastSelected >= minSeparation) {
        selectedPositions.push(pos);
        lastSelected = pos;
        if (selectedPositions.length >= maxSnippets) break;
      }
    }

    // Build snippets from selected positions
    const snippets: Snippet[] = selectedPositions.map((pos) => {
      const start = Math.max(0, pos - contextChars);
      const end = Math.min(text.length, pos + contextChars);
      let snippetText = text.slice(start, end).trim();

      if (start > 0) snippetText = "..." + snippetText;
      if (end < text.length) snippetText = snippetText + "...";

      // Collect all query terms that appear in this snippet window
      const snippetLower = snippetText.toLowerCase();
      const matchTerms = queryWords.filter((w) => snippetLower.includes(w));
      // Also include fuzzy-matched terms from positionTerms if the position is in range
      const terms = positionTerms.get(pos);
      if (terms) {
        for (const t of terms) {
          if (!matchTerms.includes(t)) matchTerms.push(t);
        }
      }

      return { text: snippetText, matchTerms };
    });

    return { snippets, matchCount };
  }

}
