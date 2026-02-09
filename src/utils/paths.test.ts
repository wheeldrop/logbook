import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { homedir } from "os";
import { join } from "path";
import { expandHome, encodeClaudePath, AGENT_PATHS } from "./paths.js";

describe("expandHome", () => {
  it("expands ~ to homedir", () => {
    expect(expandHome("~/foo")).toBe(homedir() + "/foo");
  });

  it("expands ~/ with nested path", () => {
    expect(expandHome("~/.claude/projects")).toBe(homedir() + "/.claude/projects");
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandHome("/absolute/path")).toBe("/absolute/path");
  });

  it("leaves relative paths unchanged", () => {
    expect(expandHome("relative/path")).toBe("relative/path");
  });
});

describe("encodeClaudePath", () => {
  it("replaces slashes with hyphens", () => {
    expect(encodeClaudePath("/home/testuser/src/project")).toBe("-home-testuser-src-project");
  });

  it("handles root path", () => {
    expect(encodeClaudePath("/")).toBe("-");
  });

  it("handles path without leading slash", () => {
    expect(encodeClaudePath("foo/bar")).toBe("foo-bar");
  });
});

describe("AGENT_PATHS (default, no env vars)", () => {
  it("has claude path under homedir", () => {
    expect(AGENT_PATHS.claude).toMatch(new RegExp(`^${homedir()}`));
    expect(AGENT_PATHS.claude).toMatch(/\.claude$/);
  });

  it("has codex path under homedir", () => {
    expect(AGENT_PATHS.codex).toMatch(new RegExp(`^${homedir()}`));
    expect(AGENT_PATHS.codex).toMatch(/\.codex$/);
  });

  it("has gemini path under homedir", () => {
    expect(AGENT_PATHS.gemini).toMatch(new RegExp(`^${homedir()}`));
    expect(AGENT_PATHS.gemini).toMatch(/\.gemini$/);
  });

  it("has antigravity path under gemini", () => {
    expect(AGENT_PATHS.antigravity.startsWith(AGENT_PATHS.gemini)).toBe(true);
  });
});

describe("AGENT_PATHS env var overrides", () => {
  // Since AGENT_PATHS is resolved at import time, we test the resolveAgentPaths
  // logic by re-importing the module with stubbed env vars.
  const home = homedir();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("respects CLAUDE_CONFIG_DIR", async () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/custom/claude");
    const { AGENT_PATHS: paths } = await import("./paths.js");
    expect(paths.claude).toBe("/custom/claude");
    // Others should be unaffected
    expect(paths.codex).toBe(join(home, ".codex"));
    expect(paths.gemini).toBe(join(home, ".gemini"));
  });

  it("respects CODEX_HOME", async () => {
    vi.stubEnv("CODEX_HOME", "/custom/codex");
    const { AGENT_PATHS: paths } = await import("./paths.js");
    expect(paths.codex).toBe("/custom/codex");
    expect(paths.claude).toBe(join(home, ".claude"));
  });

  it("respects GEMINI_CLI_HOME (appends .gemini)", async () => {
    vi.stubEnv("GEMINI_CLI_HOME", "/custom/gemini-home");
    const { AGENT_PATHS: paths } = await import("./paths.js");
    expect(paths.gemini).toBe("/custom/gemini-home/.gemini");
    expect(paths.antigravity).toBe("/custom/gemini-home/.gemini/antigravity");
  });

  it("uses defaults when env vars are unset", async () => {
    const { AGENT_PATHS: paths } = await import("./paths.js");
    expect(paths.claude).toBe(join(home, ".claude"));
    expect(paths.codex).toBe(join(home, ".codex"));
    expect(paths.gemini).toBe(join(home, ".gemini"));
    expect(paths.antigravity).toBe(join(home, ".gemini", "antigravity"));
  });
});
