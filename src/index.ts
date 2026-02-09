#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  if (process.argv.includes("--install")) {
    const { runInstall } = await import("./install.js");
    await runInstall();
    return;
  }

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.error("WheelDrop Logbook — MCP server for AI coding agent memory");
    console.error("");
    console.error("Usage:");
    console.error("  logbook              Start the MCP server (stdio transport)");
    console.error("  logbook --install    Auto-detect agents and configure Logbook");
    console.error("  logbook --help       Show this help message");
    console.error("");
    console.error("https://github.com/wheeldrop/logbook");
    return;
  }

  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("logbook server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
