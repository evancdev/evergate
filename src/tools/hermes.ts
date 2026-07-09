import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { services } from "@/services/index";
import {
  updateSessionSchema,
  listSessionsOutputSchema,
} from "@/schemas/hermes";
import { logger } from "@/logger";
import { FAILURE_RESPONSE, formatStructured, formatText } from "@/tools/shared";

/** Attach the Hermes agent-to-agent messaging tools to the MCP server. */
export function registerHermesTools(server: McpServer): void {
  server.registerTool(
    "update_session",
    {
      description: `Update your session's work description. Use this when your focus shifts to a different task or area of work — not for small steps within the same task.`,
      inputSchema: updateSessionSchema,
    },
    (input, extra): CallToolResult => {
      try {
        services.hermes.setDescription(input, extra.requestInfo?.headers);
        return formatText("description updated");
      } catch (err) {
        logger.error("update_session failed", err, input);
        return FAILURE_RESPONSE;
      }
    },
  );

  server.registerTool(
    "list_sessions",
    {
      description:
        "Lists the Claude sessions in the registry and what each is working on.",
      outputSchema: listSessionsOutputSchema,
    },
    (): CallToolResult => {
      try {
        return formatStructured(services.hermes.listSessions());
      } catch (err) {
        logger.error("list_sessions failed", err);
        return FAILURE_RESPONSE;
      }
    },
  );
}
