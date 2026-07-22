import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IsomorphicHeaders } from "@modelcontextprotocol/sdk/types.js";
import { registerNeo4jTools } from "@/tools/neo4j";
import { registerHermesTools } from "@/tools/hermes";
import { parseTerminalId } from "@/lib";

/** Attach the caller's tools. Some tools are added only when the request headers carry the identity they need. */
export function registerTools(
  server: McpServer,
  headers: IsomorphicHeaders | undefined,
): void {
  registerNeo4jTools(server);
  const terminalId = parseTerminalId(headers);
  if (terminalId) registerHermesTools(server, terminalId);
}
