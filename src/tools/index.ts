import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerNeo4jTools } from "@/tools/neo4j";
import { registerHermesTools } from "@/tools/hermes";

/** Attach all tools to the provided MCP server. */
export function registerTools(server: McpServer): void {
  registerNeo4jTools(server);
  registerHermesTools(server);
}
