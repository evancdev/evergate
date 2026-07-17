import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { services } from "@/services/index";
import {
  updateSessionSchema,
  sendMessageSchema,
  listSessionsOutputSchema,
  checkMessagesOutputSchema,
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
        "Lists the Claude sessions in the registry, what each is working on, and any messages waiting for you.",
      outputSchema: listSessionsOutputSchema,
    },
    (extra): CallToolResult => {
      try {
        const { sessions } = services.hermes.listSessions();
        const { messages } = services.hermes.peekMessages(
          extra.requestInfo?.headers,
        );
        return formatStructured({ sessions, messages });
      } catch (err) {
        logger.error("list_sessions failed", err);
        return FAILURE_RESPONSE;
      }
    },
  );

  server.registerTool(
    "send_message",
    {
      description:
        "Send a message to another live session — set `to` to its session id from list_sessions. The recipient reads it next time it checks messages or lists sessions.",
      inputSchema: sendMessageSchema,
    },
    (input, extra): CallToolResult => {
      try {
        const { delivered } = services.hermes.sendMessage(
          input,
          extra.requestInfo?.headers,
        );
        return formatText(
          delivered > 0
            ? "delivered"
            : "no live session with that id — nothing delivered",
        );
      } catch (err) {
        logger.error("send_message failed", err, input);
        return FAILURE_RESPONSE;
      }
    },
  );

  server.registerTool(
    "check_messages",
    {
      description:
        "Fetch and clear the messages other sessions have sent you, each with its sender and text.",
      outputSchema: checkMessagesOutputSchema,
    },
    (extra): CallToolResult => {
      try {
        return formatStructured(
          services.hermes.checkMessages(extra.requestInfo?.headers),
        );
      } catch (err) {
        logger.error("check_messages failed", err);
        return FAILURE_RESPONSE;
      }
    },
  );
}
