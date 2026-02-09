import { describe, it, expect } from "vitest";
import { isDisplayableMessage } from "./display.js";

describe("isDisplayableMessage", () => {
  it("accepts normal user prompts", () => {
    expect(isDisplayableMessage("Help me with authentication")).toBe(true);
    expect(isDisplayableMessage("Set up database migration with PostgreSQL")).toBe(true);
  });

  it("rejects tool-use interruption markers", () => {
    expect(isDisplayableMessage("[Request interrupted by user for tool use]")).toBe(false);
    expect(isDisplayableMessage("[request interrupted by user for tool use]")).toBe(false);
  });

  it("rejects local-command-caveat XML tags", () => {
    expect(isDisplayableMessage("<local-command-caveat>some system text</local-command-caveat>")).toBe(false);
  });

  it("rejects /resume commands", () => {
    expect(isDisplayableMessage("/resume")).toBe(false);
    expect(isDisplayableMessage("/resume some-session-id")).toBe(false);
  });

  it("rejects very short or whitespace-only messages", () => {
    expect(isDisplayableMessage("")).toBe(false);
    expect(isDisplayableMessage("   ")).toBe(false);
    expect(isDisplayableMessage("ok")).toBe(false);
    expect(isDisplayableMessage("hi")).toBe(false);
  });

  it("accepts messages that are short but >= 5 chars", () => {
    expect(isDisplayableMessage("hello")).toBe(true);
    expect(isDisplayableMessage("fix it")).toBe(true);
  });
});
