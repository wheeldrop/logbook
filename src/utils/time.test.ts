import { describe, it, expect } from "vitest";
import { normalizeTimestamp, isInDateRange } from "./time.js";

describe("normalizeTimestamp", () => {
  it("handles Unix milliseconds (Claude Code history format)", () => {
    const result = normalizeTimestamp(1738368000000);
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2025-02-01T00:00:00.000Z");
  });

  it("handles Unix seconds (Codex history format)", () => {
    const result = normalizeTimestamp(1738368000);
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2025-02-01T00:00:00.000Z");
  });

  it("handles ISO 8601 strings", () => {
    const result = normalizeTimestamp("2026-02-01T00:00:00Z");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("passes through Date objects", () => {
    const input = new Date("2026-02-01T00:00:00Z");
    const result = normalizeTimestamp(input);
    expect(result).toBe(input);
  });

  it("returns null for null", () => {
    expect(normalizeTimestamp(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(normalizeTimestamp(undefined)).toBeNull();
  });

  it("returns null for invalid string", () => {
    expect(normalizeTimestamp("garbage")).toBeNull();
  });

  it("returns null for non-date objects", () => {
    expect(normalizeTimestamp({} as unknown)).toBeNull();
  });

  it("distinguishes between ms and s using 1e12 threshold", () => {
    // Just above threshold → treated as milliseconds
    const ms = normalizeTimestamp(1e12 + 1);
    expect(ms).toBeInstanceOf(Date);

    // Just below threshold → treated as seconds
    const s = normalizeTimestamp(999999999999);
    expect(s).toBeInstanceOf(Date);
    // 999999999999 seconds → very far future when treated as seconds
    expect(s!.getFullYear()).toBeGreaterThan(30000);
  });
});

describe("isInDateRange", () => {
  const date = new Date("2026-02-01T00:00:00Z");

  it("returns true when no bounds are specified", () => {
    expect(isInDateRange(date)).toBe(true);
  });

  it("returns true when date is within range", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-03-01T00:00:00Z");
    expect(isInDateRange(date, from, to)).toBe(true);
  });

  it("returns false when date is before from", () => {
    const from = new Date("2026-03-01T00:00:00Z");
    expect(isInDateRange(date, from)).toBe(false);
  });

  it("returns false when date is after to", () => {
    const to = new Date("2026-01-01T00:00:00Z");
    expect(isInDateRange(date, undefined, to)).toBe(false);
  });

  it("returns true with only from bound when date is after", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(isInDateRange(date, from)).toBe(true);
  });

  it("returns true with only to bound when date is before", () => {
    const to = new Date("2026-03-01T00:00:00Z");
    expect(isInDateRange(date, undefined, to)).toBe(true);
  });
});
