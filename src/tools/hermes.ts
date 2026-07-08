import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { services } from "../services/index.js";
import { registerSessionSchema } from "../schemas/hermes.js";
import { logger } from "../logger.js";
import { FAILURE_RESPONSE, formatTool } from "./shared.js";

/** Attach the Hermes agent-to-agent messaging tools to the MCP server. */
export function registerHermesTools(server: McpServer): void {
  server.registerTool(
    "register_session",
    {
      description: `Adds your session to the registry. Use when starting a session or updating your work description.`,
      inputSchema: registerSessionSchema,
    },
    (input, extra): CallToolResult => {
      try {
        services.hermes.registerSession(input, extra.requestInfo?.headers);
        return formatTool("registered");
      } catch (err) {
        logger.error("register_session failed", err, input);
        return FAILURE_RESPONSE;
      }
    },
  );
}
