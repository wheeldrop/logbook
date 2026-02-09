import { createReadStream } from "fs";
import { createInterface } from "readline";

/**
 * Stream-parse a JSONL file, yielding one parsed object per line.
 * Silently skips blank lines and malformed JSON.
 */
export async function* readJsonl<T = unknown>(
  filePath: string,
): AsyncGenerator<T> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed) as T;
    } catch {
      // Skip malformed lines — these occur in practice when sessions are
      // interrupted mid-write.
    }
  }
}
