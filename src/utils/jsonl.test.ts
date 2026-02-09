import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readJsonl } from "./jsonl.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "test-fixtures");

interface TestEntry {
  name: string;
  age: number;
}

async function collectAll<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}

describe("readJsonl", () => {
  it("reads valid JSONL lines", async () => {
    const items = await collectAll(
      readJsonl<TestEntry>(join(fixturesDir, "jsonl-valid.jsonl")),
    );
    expect(items).toHaveLength(3);
    expect(items[0].name).toBe("alice");
    expect(items[1].name).toBe("bob");
    expect(items[2].name).toBe("charlie");
  });

  it("skips blank lines and malformed JSON", async () => {
    const items = await collectAll(
      readJsonl<TestEntry>(join(fixturesDir, "jsonl-mixed.jsonl")),
    );
    expect(items).toHaveLength(3);
    expect(items[0].name).toBe("alice");
    expect(items[1].name).toBe("bob");
    expect(items[2].name).toBe("charlie");
  });

  it("yields nothing for empty file", async () => {
    const items = await collectAll(
      readJsonl<TestEntry>(join(fixturesDir, "jsonl-empty.jsonl")),
    );
    expect(items).toHaveLength(0);
  });
});
