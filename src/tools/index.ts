import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerNeo4jTools } from "./neo4j.js";
import { registerHermesTools } from "./hermes.js";

/** Attach all tools to the provided MCP server. */
export function registerTools(server: McpServer): void {
  registerNeo4jTools(server);
  registerHermesTools(server);
}
