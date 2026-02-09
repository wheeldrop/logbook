# Search Implementation Research

> Researched 2026-02-07 for the convo-mcp project.
> Context: ~1,500 conversation sessions, ~900MB total, across 4 AI coding agents.
> Documents range from one-line history entries to multi-thousand-line conversation transcripts.
> Current implementation: MiniSearch (in-memory, rebuilt on every server start).

---

## Table of Contents

1. [Full-Text Search Libraries](#1-full-text-search-libraries)
2. [BM25 / TF-IDF Ranking](#2-bm25--tf-idf-ranking)
3. [Semantic / Embedding-Based Search](#3-semantic--embedding-based-search)
4. [Hybrid Search (BM25 + Semantic)](#4-hybrid-search-bm25--semantic)
5. [Persistent Indexing](#5-persistent-indexing)
6. [Incremental Indexing](#6-incremental-indexing)
7. [All-in-One Solutions](#7-all-in-one-solutions)
8. [Recommendations](#8-recommendations)

---

## 1. Full-Text Search Libraries

### Comparison Matrix

| Library | BM25 | Fuzzy | Prefix | Bundle (min+gz) | Zero-dep | TypeScript | Maintained | Weekly DL |
|---|---|---|---|---|---|---|---|---|
| **MiniSearch** | BM25+ | Yes (edit distance) | Yes | ~7 kB | Yes | Yes (native) | Active (2025) | ~550k |
| **FlexSearch** | No (contextual scoring) | Yes | Yes | ~6 kB (light) | Yes | Via fork | Active (v0.8) | ~660k |
| **Orama** | BM25 (+ QPS, PT15 plugins) | Yes (typo tolerance) | Yes | ~2 kB (core) | Yes | Yes (native) | Active (2025) | ~200k |
| **Lunr.js** | TF-IDF (Okapi-BM25-like) | Yes (edit distance) | Yes | ~8.4 kB | Yes | Via @types | Unmaintained (last commit 5y ago) | ~3.3M |
| **Fuse.js** | No (custom scoring) | Yes (Bitap) | No | ~5 kB | Yes | Yes | Active | ~3.1M |
| **search-index** | TF-IDF | Yes | Yes | ~50 kB+ (deps) | No (Level) | Limited | Low activity | ~3k |

### Detailed Analysis

#### MiniSearch (current choice)
- **Algorithm**: BM25+ variant with configurable k1, b, and delta parameters
- **Strengths**: Excellent BM25+ ranking, native TypeScript, great API design, serialization via `JSON.stringify`/`loadJSON`, auto-suggest, custom tokenizers, field boosting
- **Weaknesses**: In-memory only (no persistent storage), no built-in vector search, performance degrades on very large datasets (>100k docs with long content)
- **Index build**: Fast for our scale (~1,500 docs in <2 seconds estimated)
- **Query speed**: Sub-millisecond for typical queries
- **Memory**: Proportional to indexed content; for 900MB raw data, expect 200-400MB index footprint
- **MCP suitability**: Excellent -- lightweight, zero dependencies, fast startup
- **Serialization**: Built-in `toJSON()`/`loadJSON()` with async variant `loadJSONAsync()` for non-blocking deserialization. Format is stable within major versions.

#### FlexSearch
- **Algorithm**: Proprietary "contextual scoring" (not BM25) -- indexes term context/proximity rather than frequency-based ranking
- **Strengths**: Claimed fastest search performance (1M+ ops/sec in benchmarks), worker thread support, persistent index adapters (SQLite, Redis, Postgres, MongoDB) in v0.8, memory-efficient encoding
- **Weaknesses**: Not BM25 (relevance ranking is different and may be worse for long documents), TypeScript support is via a community fork (`flexsearch-ts`), v0.8 API is significantly different from v0.7 and documentation is still incomplete, stored fields support is limited
- **v0.8 persistent storage**: Can mount indexes on SQLite, Redis, Postgres, MongoDB, Clickhouse, IndexedDB via database adapters. This is a significant feature for our use case.
- **MCP suitability**: Good, but the non-BM25 scoring and incomplete v0.8 docs are concerns
- **Verdict**: Interesting for its persistent storage adapters, but the lack of BM25 makes it unsuitable as a primary search engine for conversation logs where term frequency matters

#### Orama
- **Algorithm**: BM25 by default, with alternative plugins (QPS for proximity-based scoring, PT15 for positional token scoring)
- **Strengths**: Full-text + vector + hybrid search in one library, native TypeScript, BM25 ranking, plugin ecosystem (embeddings, data persistence, QPS), facets, geosearch, filters, 30-language stemming
- **Weaknesses**: Persistence plugin has a 512MB file size limit (V8 string limitation on JSON serialization), plugin-embeddings requires TensorFlow.js backend (heavier than transformers.js), relatively newer/less battle-tested than MiniSearch for pure full-text
- **Hybrid search**: Built-in `mode: 'hybrid'` with configurable `hybridWeights: { text: 0.8, vector: 0.2 }`
- **Persistence**: `@orama/plugin-data-persistence` supports JSON, DPack, and binary (MessagePack) formats. The 512MB limit is a known issue that could affect our ~900MB dataset.
- **MCP suitability**: Good, but the TF.js dependency for embeddings is heavy. Core full-text search is lightweight.
- **Verdict**: Most interesting all-in-one option. The 512MB persistence limit is a blocker for full deep search but fine for tier-1 (history + memory files, which are much smaller)

#### Lunr.js
- **Status**: Effectively abandoned (no commits in 5 years). Still widely used due to legacy adoption.
- **Verdict**: Do not adopt. MiniSearch is a superior successor with active maintenance.

#### Fuse.js
- **Algorithm**: Bitap fuzzy matching -- no inverted index, scans all documents linearly
- **Strengths**: Great for small datasets (<1,000 items), very simple API
- **Weaknesses**: O(n) search time, no BM25/TF-IDF ranking, not designed for full-text search at scale
- **Verdict**: Not suitable for our use case (1,500+ documents, some very large)

#### search-index
- **Algorithm**: TF-IDF with LevelDB-backed persistent storage
- **Strengths**: Persistent indexing out of the box, network-resilient
- **Weaknesses**: Many dependencies (LevelDB stack), lower community adoption (~3k weekly DL), API is more complex, less performant than MiniSearch/Orama
- **Verdict**: Interesting for persistence, but the LevelDB dependency stack and low adoption make it risky

### Full-Text Search Verdict

**MiniSearch remains the best choice for pure full-text search.** It already uses BM25+ (which is better than standard BM25), has excellent TypeScript support, zero dependencies, built-in serialization, and is well-suited for our data scale. If we add vector/hybrid search later, Orama is the most compelling upgrade path.

---

## 2. BM25 / TF-IDF Ranking

### Does MiniSearch Use BM25?

**Yes.** MiniSearch uses the **BM25+** variant, which is an improvement over standard BM25. BM25+ adds a lower-bound normalization parameter (delta) that prevents very long documents from being unfairly penalized. MiniSearch exposes three configurable parameters:

- **k1** (term frequency saturation): Default ~1.2, controls how quickly term frequency saturates. Higher = more weight to repeated terms.
- **b** (length normalization): Default ~0.75, controls document length normalization. Higher = longer documents penalized more.
- **delta** (BM25+ lower bound): Default ~0.5, prevents zero-scoring for terms in very long documents.

These are tunable but the defaults are well-chosen for general use.

### Competitor: ai-sessions-mcp (Go + SQLite)

The ai-sessions-mcp competitor implements BM25 scoring manually in Go with a SQLite-backed inverted index:

- **Approach**: Custom `bm25.go` scoring + `cache.go` for SQLite-backed term index + stats
- **Schema**: `sessions` + `term_index` + `stats` tables
- **Advantage**: Persistent index (survives restarts), SQL-queryable
- **Disadvantage**: Custom BM25 implementation may have bugs/edge cases vs. battle-tested libraries, Go-only

**Is the SQLite BM25 approach better?** It depends:
- For **persistence**: Yes, SQLite survives restarts without reindexing
- For **ranking quality**: No. MiniSearch's BM25+ is a well-tested implementation with tunable parameters. A custom BM25 in Go may have subtle issues.
- For **query performance**: MiniSearch's in-memory index is faster per query, but SQLite's disk-backed index uses less RAM

### SQLite FTS5 Built-in BM25

SQLite's FTS5 extension has a built-in `bm25()` ranking function:

```sql
SELECT *, bm25(conversations_fts) as rank
FROM conversations_fts
WHERE conversations_fts MATCH 'search query'
ORDER BY rank;
```

- **Advantages**: Zero additional dependencies (just better-sqlite3), persistent, handles 3M+ rows/hour indexing, sub-millisecond queries, built-in tokenizers and stemmers
- **Disadvantages**: Less control over BM25 parameters than MiniSearch, no fuzzy matching (must be implemented separately), no prefix search by default (though FTS5 supports `prefix` option)

### BM25 Verdict

**MiniSearch's BM25+ is already excellent.** If we move to persistent indexing, SQLite FTS5's built-in `bm25()` is the most practical alternative. There is no need for a separate BM25 library.

---

## 3. Semantic / Embedding-Based Search

### State of the Art for Local (No API) Semantic Search in Node.js

The key components are: (1) an embedding model, (2) an inference runtime, and (3) a vector store/index.

### Embedding Models

| Model | Dimensions | Size (ONNX) | Max Tokens | Quality (MTEB avg) | Speed |
|---|---|---|---|---|---|
| **all-MiniLM-L6-v2** | 384 | ~23 MB (fp32), ~12 MB (q8) | 256 | ~56% Top-5 | Very fast (<30ms/query) |
| **all-MiniLM-L12-v2** | 384 | ~45 MB | 256 | ~58% Top-5 | Fast |
| **BGE-small-en-v1.5** | 384 | ~45 MB | 512 | ~62% Top-5 | Fast |
| **nomic-embed-text-v1.5** | 768 (Matryoshka, can truncate) | ~130 MB | 8192 | ~65% Top-5 | Moderate |
| **EmbeddingGemma** | 768 | ~308M params, <200MB quantized | 8192 | High | Moderate |

**Recommendations**:
- **For speed + minimal footprint**: `all-MiniLM-L6-v2` (the episodic-memory choice). Only 23MB, <30ms inference, 384-dim vectors. Good enough for conversation search.
- **For better quality**: `BGE-small-en-v1.5` or `nomic-embed-text-v1.5`. The latter supports 8192 tokens (important for long conversations) and Matryoshka embeddings (can use 256/384/768 dims).
- **Not recommended**: EmbeddingGemma -- too new, limited ONNX support in JS ecosystem.

### Inference Runtimes

| Runtime | Backend | Node.js Support | Notes |
|---|---|---|---|
| **@huggingface/transformers** (v3) | ONNX Runtime | Yes (onnxruntime-node) | High-level API, model hub integration, quantization (q4/q8/fp16/fp32) |
| **onnxruntime-node** | ONNX Runtime | Yes (native) | Low-level, fastest raw performance, more setup required |

**transformers.js v3** (now `@huggingface/transformers`) is the clear winner for developer experience:

```typescript
import { pipeline } from '@huggingface/transformers';

const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
  dtype: 'q8',  // 8-bit quantization for smaller memory
});

const output = await embedder('search query', { pooling: 'mean', normalize: true });
// output.data is a Float32Array of 384 dimensions
```

### Cold-Start and Performance Characteristics

Based on episodic-memory implementation and community reports:

| Metric | all-MiniLM-L6-v2 (q8) | Notes |
|---|---|---|
| **First load (model download)** | 1-2 minutes | One-time; cached to `~/.cache/huggingface/` (~400MB cache dir) |
| **Cold start (from disk cache)** | 3-8 seconds | Loading ONNX model into memory |
| **Warm query latency** | 10-30 ms per query | Single sentence embedding |
| **Batch embedding** | ~127 embeddings in 45s | From episodic-memory sync benchmark |
| **Memory footprint** | ~100-200 MB | Model + ONNX runtime |
| **Model file size** | ~12 MB (q8), ~23 MB (fp32) | On-disk |

**Critical concern for MCP stdio servers**: The 3-8 second cold start for model loading is significant. An MCP server should ideally respond within 1-2 seconds. Strategies:
1. **Lazy loading**: Only load the embedding model on first semantic search request
2. **Pre-warming**: Start loading the model immediately after server start but don't block
3. **Separate process**: Run embedding generation in a worker thread

### Vector Storage Options

| Library | Type | Persistence | Algorithm | Node.js | Native Deps |
|---|---|---|---|---|---|
| **sqlite-vec** | SQLite extension | Yes (SQLite DB) | Brute-force (exact) | Yes (better-sqlite3) | Yes (prebuilt binary) |
| **hnswlib-node** | Standalone | File-based save/load | HNSW (approximate) | Yes | Yes (C++ addon) |
| **usearch** | Standalone | File-based save/load | HNSW (approximate) | Yes | Yes (C++ addon) |
| **hnswsqlite** | Hybrid | SQLite + HNSW | HNSW | Yes | Yes (both) |
| **Orama** | In-memory | JSON/DPack persistence | Linear scan | Yes | No |

**Recommendations**:
- **For simplicity**: sqlite-vec with better-sqlite3. Brute-force is fine for <10,000 vectors (our scale). One database for both FTS5 and vectors.
- **For speed at scale**: hnswlib-node. True ANN search, but adds a C++ native dependency.
- **For zero native deps**: Orama's built-in vector search. Linear scan is fast enough for <10,000 vectors.

### How Well Does episodic-memory's Approach Work?

The episodic-memory project (by Jesse Vincent/obra) uses:
- `@xenova/transformers` (now `@huggingface/transformers`) with `all-MiniLM-L6-v2`
- `better-sqlite3` + `sqlite-vec` for storage
- SQLite LIKE queries as text search fallback

**Strengths**:
- Proven architecture for Claude Code conversation search
- Local, offline, no API keys needed
- SQLite persistence means fast restarts after initial indexing

**Weaknesses**:
- all-MiniLM-L6-v2 has a 256-token limit (conversations are much longer; must chunk)
- No BM25 full-text search (only LIKE queries, which are slow and imprecise)
- 3-8 second cold start for model loading
- ~400MB cache directory for ONNX models
- No hybrid search (vector OR text, not both combined)

### Semantic Search Verdict

**For our project, semantic search should be an optional enhancement, not a replacement for BM25.** The recommended stack:
1. `@huggingface/transformers` v3 with `all-MiniLM-L6-v2` (q8) for embeddings
2. `sqlite-vec` with `better-sqlite3` for vector storage (same DB as FTS5)
3. Lazy model loading to avoid cold-start penalty
4. Chunk long conversations into ~200-token segments for embedding

---

## 4. Hybrid Search (BM25 + Semantic)

### Why Hybrid?

BM25 excels at exact keyword matching ("error in AuthService.ts") while semantic search excels at conceptual matching ("authentication failures"). Combining them produces better results than either alone.

### Reciprocal Rank Fusion (RRF)

RRF is the standard algorithm for combining ranked results from multiple search methods:

```
RRF_score(d) = sum over all rankers r: 1 / (k + rank_r(d))
```

Where `k` is a constant (typically 60) and `rank_r(d)` is the rank of document `d` in ranker `r`.

**Implementation in TypeScript** is straightforward (~30 lines):

```typescript
function reciprocalRankFusion(
  results: Map<string, number>[],  // docId -> rank for each ranker
  k: number = 60
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const rankerResults of results) {
    for (const [docId, rank] of rankerResults) {
      scores.set(docId, (scores.get(docId) ?? 0) + 1 / (k + rank));
    }
  }
  return scores;
}
```

**Advantages of RRF**:
- Score-agnostic: works even when BM25 scores and cosine similarities are on different scales
- Simple to implement
- Well-studied and robust

### Library Options for Hybrid Search

#### Orama (Built-in Hybrid)
```typescript
const results = search(db, {
  mode: 'hybrid',
  term: 'authentication error',
  vector: {
    value: queryEmbedding,
    property: 'embedding',
  },
  hybridWeights: { text: 0.7, vector: 0.3 },
});
```

- **Pros**: One library, one API, configurable weights
- **Cons**: Uses weighted score combination (not RRF), 512MB persistence limit, TF.js dependency for auto-embeddings

#### Custom RRF with MiniSearch + sqlite-vec
- Run BM25 search via MiniSearch (or SQLite FTS5)
- Run vector search via sqlite-vec
- Combine with RRF
- **Pros**: Best-in-class components for each, full control, no 512MB limit
- **Cons**: More code to write and maintain

#### Engram MCP (Reference Architecture)
Engram (199-biotechnologies/engram) implements a sophisticated hybrid:
- BM25 keyword search
- ColBERT semantic search
- Knowledge graph relationships
- Temporal decay (older memories score lower)
- Salience boosting (frequently recalled items score higher)

This is overengineered for our use case but demonstrates the potential of hybrid approaches.

### Hybrid Search Verdict

**Start with BM25 only (MiniSearch). Add hybrid search as a Phase 2 enhancement.** When adding it:
1. Use custom RRF with MiniSearch (or FTS5) + sqlite-vec
2. Do NOT use Orama for hybrid -- the weighted combination is less robust than RRF, and the persistence limit is a problem
3. Allow users to choose search mode: `keyword` (BM25 only), `semantic` (vector only), or `hybrid` (RRF fusion)

---

## 5. Persistent Indexing

### Current Problem

The server rebuilds the entire MiniSearch index on every start. For ~1,500 documents, this takes ~2 seconds (estimated). As the dataset grows, this will become a bottleneck.

### Options

#### Option A: MiniSearch JSON Serialization (Simplest)

MiniSearch supports `JSON.stringify(index)` to serialize and `MiniSearch.loadJSON(json, options)` to deserialize.

```typescript
// Save
const json = JSON.stringify(miniSearch);
writeFileSync('index.json', json);

// Load
const json = readFileSync('index.json', 'utf8');
const miniSearch = MiniSearch.loadJSON(json, { fields: ['text', 'project'] });
```

- **Pros**: Zero additional dependencies, already available, format stable within major versions
- **Cons**: JSON serialization is slow and memory-intensive for large indexes (V8 string limit at ~512MB), no incremental updates (must re-serialize entire index), no partial loading
- **Estimated save/load time**: 0.5-2 seconds for our dataset (much faster than rebuilding from source files)
- **MCP suitability**: Good for current scale, will hit limits as data grows

#### Option B: SQLite with FTS5 + better-sqlite3 (Recommended for Growth)

Use SQLite as both the persistence layer and the search engine:

```typescript
import Database from 'better-sqlite3';

const db = new Database('convo-mcp.db');
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
    text, project, agent,
    content='conversations',
    content_rowid='id'
  );
`);

// Insert
db.prepare('INSERT INTO conversations(agent, sessionId, text, project) VALUES (?, ?, ?, ?)').run(...);

// Search with BM25 ranking
const results = db.prepare(`
  SELECT *, bm25(conversations_fts) as rank
  FROM conversations_fts
  WHERE conversations_fts MATCH ?
  ORDER BY rank
  LIMIT 20
`).all(query);
```

- **Pros**: True persistence (instant restart), built-in BM25, handles GB-scale data, incremental updates, same DB can host sqlite-vec for vectors later, battle-tested (SQLite is the most deployed database in the world)
- **Cons**: Native dependency (better-sqlite3 requires node-gyp or prebuilt binary), slightly more complex API than MiniSearch, no built-in fuzzy matching (must implement separately or use porter tokenizer + prefix queries)
- **Estimated startup**: <100ms (just open the DB file)
- **Query speed**: Sub-millisecond (single-digit ms) for typical FTS5 queries
- **Indexing speed**: 3M+ rows/hour (well beyond our needs)
- **MCP suitability**: Excellent. better-sqlite3 is synchronous (good for stdio), widely used in MCP servers, prebuilt binaries available

#### Option C: FlexSearch v0.8 Persistent Adapters

FlexSearch v0.8 supports mounting indexes on SQLite, Redis, Postgres, MongoDB:

```typescript
import { Document } from 'flexsearch';

const index = new Document({
  db: sqliteAdapter,  // persistent storage
  document: { id: 'id', index: ['text', 'project'] }
});
```

- **Pros**: Persistent + in-memory hybrid, worker thread support, auto-commit batching
- **Cons**: v0.8 documentation is incomplete, non-BM25 scoring, API is still stabilizing, unclear TypeScript support
- **MCP suitability**: Risky due to immature v0.8 API

#### Option D: LevelDB (via `level` or `classic-level`)

- **Pros**: Very fast key-value operations, well-established in Node.js ecosystem
- **Cons**: No built-in full-text search (would need to build inverted index manually), less flexible than SQLite
- **Verdict**: Only useful as a backing store for search-index library, not standalone

#### Option E: LMDB (via `lmdb-js`)

- **Pros**: Fastest reads of any embedded DB (memory-mapped), excellent for read-heavy workloads like search
- **Cons**: Key-value only (no FTS), less ecosystem support than SQLite, memory-mapped files can be tricky
- **Verdict**: Could be excellent for caching embeddings/vectors, but not for full-text search

### Startup Time Comparison

| Approach | Cold Start (rebuild) | Warm Start (from persistent) |
|---|---|---|
| MiniSearch (current) | ~2 seconds | N/A (always rebuilds) |
| MiniSearch + JSON file | ~2 seconds (first run) | ~0.5-1 second (deserialize) |
| SQLite FTS5 | ~2-5 seconds (first run) | <100 ms (DB already populated) |
| FlexSearch persistent | ~2-5 seconds (first run) | <200 ms (estimated) |

### Persistent Indexing Verdict

**Option A (MiniSearch JSON) is the quick win.** Implement it now -- serialize the index after building, load from file on subsequent starts, invalidate when source files are newer.

**Option B (SQLite FTS5) is the long-term play.** When we add semantic search (sqlite-vec), we'll already have better-sqlite3 as a dependency. At that point, migrate full-text search to FTS5 and get persistence + incremental updates for free.

---

## 6. Incremental Indexing

### Problem

Currently, the entire index is rebuilt from scratch on every server start. As the dataset grows, we need to detect and index only new/changed files.

### Approach 1: File Modification Time Comparison

Track `mtime` of indexed files. On startup, compare mtimes against stored values. Only reindex changed files.

```typescript
import { statSync } from 'fs';

interface IndexMeta {
  files: Map<string, number>;  // filePath -> mtime
}

function getChangedFiles(meta: IndexMeta, currentFiles: string[]): string[] {
  return currentFiles.filter(f => {
    const mtime = statSync(f).mtimeMs;
    return !meta.files.has(f) || meta.files.get(f)! < mtime;
  });
}
```

- **Pros**: Simple, no additional dependencies, works with any index backend
- **Cons**: Only detects changes on startup, not real-time

### Approach 2: File Watching with chokidar

Watch data directories for changes and update the index in real-time:

```typescript
import chokidar from 'chokidar';

const watcher = chokidar.watch([
  '~/.claude/projects/',
  '~/.codex/sessions/',
  '~/.gemini/tmp/',
], {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 2000 },  // Wait for file to finish writing
});

watcher.on('add', (path) => indexNewFile(path));
watcher.on('change', (path) => reindexFile(path));
```

- **chokidar v5** (2025): ESM-only, Node 20+, uses `fs.watch` by default (no polling, low CPU)
- **Bundle**: ~10 kB
- **Pros**: Real-time updates, well-tested library (~40M weekly downloads), efficient fs.watch-based
- **Cons**: Adds a dependency, file watchers consume inotify handles (Linux has a default limit of 8192), needs `awaitWriteFinish` for files being actively written (AI agent sessions)

### Approach 3: Startup Diff (No Watcher)

Most practical for an MCP server that starts/stops frequently:

1. On first run: build full index, save index + file manifest (path -> mtime + size) to disk
2. On subsequent runs: load index from disk, scan file manifest, reindex only changed/new files
3. Delete removed files from index

This avoids the overhead of a persistent file watcher while still providing incremental updates.

### MiniSearch Incremental Support

MiniSearch supports incremental operations:
- `miniSearch.add(document)` -- add a single document
- `miniSearch.remove(document)` -- remove by ID
- `miniSearch.replace(document)` -- update (remove + add)
- `miniSearch.addAll(documents)` -- bulk add
- `miniSearch.removeAll()` -- clear

These work well for incremental updates without rebuilding the entire index.

### SQLite FTS5 Incremental Support

SQLite is inherently incremental -- INSERT/UPDATE/DELETE operations update the FTS5 index automatically. No special handling needed.

### Incremental Indexing Verdict

**Use Approach 3 (Startup Diff) as the primary strategy.** It is simple, requires no additional dependencies, and works well with the MCP server lifecycle (start -> serve -> stop). Store a manifest of indexed files alongside the serialized index.

**Add chokidar watching as an optional enhancement** for long-running server instances. This is lower priority since MCP servers typically have short lifespans.

---

## 7. All-in-One Solutions

### Orama

**The most complete all-in-one option for our TypeScript/Node.js context.**

| Feature | Support | Quality |
|---|---|---|
| Full-text search | BM25, QPS, PT15 | Good (well-tested BM25) |
| Fuzzy matching | Built-in typo tolerance | Good |
| Vector search | Built-in (linear scan) | Adequate for <10k vectors |
| Hybrid search | Built-in (weighted combination) | Decent (not RRF) |
| Embeddings | Via plugin-embeddings (TF.js) | Works but heavy dependency |
| Persistence | Via plugin-data-persistence | Limited (512MB JSON limit) |
| TypeScript | Native | Excellent |
| Bundle size | ~2 kB core | Excellent |
| Dependencies | Zero (core) | Excellent |

**Gotchas**:
- The 512MB persistence limit (V8 JSON string limit) is a real problem for large datasets
- plugin-embeddings uses TensorFlow.js, not transformers.js (TF.js is heavier, less model variety)
- Hybrid search uses weighted score combination, not RRF (less robust)
- No SQLite integration (can't share a DB with other components)
- QPS and PT15 alternative algorithms are interesting but less studied than BM25

**Verdict**: Orama is a strong contender if we want to minimize dependencies and get hybrid search quickly. However, the 512MB persistence limit and TF.js dependency are significant drawbacks. It would work well for our tier-1 index (history + memory files, <50MB) but not for deep search of full conversations.

### Typesense (Embedded)

Typesense is primarily a server-based search engine, not embeddable in Node.js. It requires running a separate process. **Not suitable for an MCP stdio server.**

### Meilisearch

Similar to Typesense -- server-based, not embeddable. **Not suitable.**

### SQLite FTS5 + sqlite-vec (DIY All-in-One)

Build our own all-in-one using SQLite as the foundation:

| Feature | Implementation | Quality |
|---|---|---|
| Full-text search | FTS5 built-in BM25 | Excellent |
| Fuzzy matching | Custom (Levenshtein + FTS5 prefix) | Requires work |
| Vector search | sqlite-vec extension | Good (brute-force, fine for <10k vectors) |
| Hybrid search | Custom RRF | Excellent (full control) |
| Embeddings | @huggingface/transformers (separate) | Excellent |
| Persistence | SQLite (native) | Excellent (no size limits) |
| TypeScript | Via better-sqlite3 | Good |
| Native deps | better-sqlite3, sqlite-vec | Moderate overhead |

**Verdict**: This is more work to set up but avoids all the limitations of Orama. It is the approach used by episodic-memory and ai-sessions-mcp (independently), suggesting it is a well-validated architecture for this problem space.

---

## 8. Recommendations

### Phase 1: Quick Wins (Current Sprint)

**Keep MiniSearch. Add JSON serialization for persistence.**

1. After building the tier-1 index, serialize it to `~/.convo-mcp/index.json` with a manifest of indexed files (path -> mtime)
2. On startup, check if the index file exists and is newer than all source files; if so, load it instead of rebuilding
3. Use `MiniSearch.loadJSONAsync()` for non-blocking deserialization
4. Invalidate the cache when the server version changes (serialization format may change between MiniSearch versions)

**Effort**: Small (1-2 hours)
**Impact**: Startup time drops from ~2s to ~0.5s on warm starts

### Phase 2: SQLite Migration (When Adding New Features)

**Migrate to better-sqlite3 + FTS5 as the primary search backend.**

1. Add `better-sqlite3` as a dependency
2. Create a SQLite database at `~/.convo-mcp/convo-mcp.db`
3. Use FTS5 for full-text search with BM25 ranking
4. Store document metadata in regular tables
5. Implement incremental indexing (only reindex changed files)
6. Add fuzzy matching via a combination of FTS5 prefix queries and Levenshtein distance post-filtering

**Effort**: Medium (1-2 days)
**Impact**: Instant startup (<100ms), incremental updates, foundation for vector search

### Phase 3: Semantic Search (Optional Enhancement)

**Add vector search using transformers.js + sqlite-vec.**

1. Add `@huggingface/transformers` and `sqlite-vec` as optional dependencies
2. Use `all-MiniLM-L6-v2` (q8) for embeddings
3. Store vectors in sqlite-vec (same SQLite DB as FTS5)
4. Lazy-load the embedding model on first semantic search request
5. Chunk long conversations into ~200-token segments
6. Implement RRF-based hybrid search (BM25 + vector)
7. Add a `mode` parameter to the search tool: `keyword`, `semantic`, `hybrid`

**Effort**: Large (3-5 days)
**Impact**: Conceptual/semantic search capability, better results for vague queries

### Phase 4: Advanced Features (Future)

Consider:
- Temporal decay (recent conversations score higher)
- Usage-based boosting (frequently accessed sessions score higher)
- Cross-session knowledge graph (entities/concepts linking sessions)
- Worker thread embedding generation for non-blocking operation

### Dependency Impact Summary

| Phase | New Dependencies | Install Size Impact |
|---|---|---|
| Phase 1 | None | 0 |
| Phase 2 | better-sqlite3 | ~5 MB (prebuilt binary) |
| Phase 3 | @huggingface/transformers, sqlite-vec, onnxruntime-node | ~50-100 MB (model files cached separately, ~400MB) |
| Phase 4 | None (custom code) | 0 |

### MCP Server Context Considerations

Important factors for our stdio-based MCP server:

1. **Startup time matters**: The server starts as a subprocess for each client connection. Aim for <500ms to first response.
2. **Memory matters**: The server runs alongside the AI coding agent, which already uses significant memory. Keep our footprint under 200MB.
3. **No long-running processes**: Don't assume the server stays alive between requests. Persistence is essential.
4. **Synchronous is fine**: better-sqlite3's synchronous API is actually an advantage for stdio MCP servers (no async complexity in the request pipeline).
5. **Native dependencies are acceptable**: MCP servers are installed locally, not in browsers. Native deps like better-sqlite3 are fine.
6. **Model caching**: If using transformers.js, the ONNX model cache (~400MB in `~/.cache/huggingface/`) is shared across all tools that use transformers.js. Many developers already have it.

---

## Sources

### Full-Text Search Libraries
- [MiniSearch GitHub](https://github.com/lucaong/minisearch)
- [MiniSearch BM25 Parameters](https://lucaong.github.io/minisearch/types/MiniSearch.BM25Params.html)
- [FlexSearch GitHub](https://github.com/nextapps-de/flexsearch)
- [FlexSearch Persistent Storage Docs](https://github.com/nextapps-de/flexsearch/blob/master/doc/persistent.md)
- [Orama GitHub](https://github.com/oramasearch/orama)
- [Orama BM25 Algorithm Docs](https://docs.orama.com/open-source/usage/search/bm25-algorithm/)
- [Orama Hybrid Search Docs](https://docs.orama.com/cloud/performing-search/hybrid-search)
- [Orama Data Persistence Plugin](https://docs.orama.com/open-source/plugins/plugin-data-persistence)
- [Orama 512MB Persistence Limit (Issue #851)](https://github.com/oramasearch/orama/issues/851)
- [Orama Plugin Embeddings (npm)](https://www.npmjs.com/package/@orama/plugin-embeddings)
- [Lunr.js](https://lunrjs.com/)
- [Fuse.js](https://www.fusejs.io/)
- [search-index (npm)](https://www.npmjs.com/package/search-index)
- [JS Search Library Comparison (npm-compare)](https://npm-compare.com/elasticlunr,flexsearch,fuse.js,minisearch)
- [Top 6 JavaScript Search Libraries (byby.dev)](https://byby.dev/js-search-libraries)
- [Transitioning from Lunr.js to MiniSearch (DEV)](https://dev.to/hetarth02/transitioning-from-lunrjs-to-minisearchjs-36aa)

### BM25 / TF-IDF
- [BM25 Explained (vishwasg.dev)](https://vishwasg.dev/blog/2025/01/20/bm25-explained-a-better-ranking-algorithm-than-tf-idf/)
- [Okapi BM25 (Wikipedia)](https://en.wikipedia.org/wiki/Okapi_BM25)
- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html)
- [SQLite FTS5 in Practice (TheLinuxCode)](https://thelinuxcode.com/sqlite-full-text-search-fts5-in-practice-fast-search-ranking-and-real-world-patterns/)
- [Replaced Elasticsearch with SQLite FTS5 (Medium)](https://medium.com/@build_break_learn/replaced-elasticsearch-with-sqlite-fts5-100x-faster-5343a4458dd4)

### Semantic / Embedding Search
- [Transformers.js v3 Announcement](https://huggingface.co/blog/transformersjs-v3)
- [Transformers.js Server-side Node.js Tutorial](https://huggingface.co/docs/transformers.js/tutorials/node)
- [all-MiniLM-L6-v2 (Hugging Face)](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- [nomic-embed-text-v1.5 (Hugging Face)](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)
- [Best Open-Source Embedding Models Benchmarked](https://supermemory.ai/blog/best-open-source-embedding-models-benchmarked-and-ranked/)
- [Best Open-Source Embedding Models 2026 (BentoML)](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models)
- [EmbeddingGemma (Google)](https://developers.googleblog.com/introducing-embeddinggemma/)
- [How to Create Vector Embeddings in Node.js](https://philna.sh/blog/2024/09/25/how-to-create-vector-embeddings-in-node-js/)
- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec)
- [sqlite-vec Node.js Guide](https://alexgarcia.xyz/sqlite-vec/js.html)
- [hnswlib-node via LangChain](https://js.langchain.com/docs/integrations/vectorstores/hnswlib/)
- [USearch GitHub](https://github.com/unum-cloud/USearch)
- [hnswsqlite (Medium)](https://medium.com/@praveencs87/hnswsqlite-persistent-vector-search-for-node-js-with-hnswlib-and-sqlite-8c5cdc1f3ba8)

### Hybrid Search
- [RRF TypeScript Implementation (alexop.dev)](https://alexop.dev/tils/reciprocal-rank-fusion-typescript-vue/)
- [Understanding RRF (DEV Community)](https://dev.to/master-rj/understanding-reciprocal-rank-fusion-rrf-in-retrieval-augmented-systems-52kc)
- [RRF for Hybrid Search (OpenSearch)](https://opensearch.org/blog/introducing-reciprocal-rank-fusion-hybrid-search/)
- [Hybrid Search: BM25 + Vector (Medium/CodeX)](https://medium.com/codex/96-hybrid-search-combining-bm25-and-vector-search-7a93adfd3f4e)
- [7 Hybrid Search Recipes (Medium)](https://medium.com/@connect.hashblock/7-hybrid-search-recipes-bm25-vectors-without-lag-467189542bf0)

### Competitor Implementations
- [episodic-memory GitHub](https://github.com/obra/episodic-memory)
- [episodic-memory DeepWiki](https://deepwiki.com/obra/episodic-memory)
- [Engram MCP GitHub](https://github.com/199-biotechnologies/engram)
- [ai-sessions-mcp (competitor -- see COMPETITOR_ANALYSIS.md)](https://github.com/yoavf/ai-sessions-mcp)

### Persistent Storage
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3)
- [Level (LevelDB for Node.js)](https://leveljs.org/)
- [LMDB Benchmarks (symas.com)](http://www.lmdb.tech/bench/microbench/)

### File Watching
- [chokidar GitHub](https://github.com/paulmillr/chokidar)
- [chokidar (npm)](https://www.npmjs.com/package/chokidar)
