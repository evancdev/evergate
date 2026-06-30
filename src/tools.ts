import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as graph from "./graph.js";
import { upsertSchema } from "./schema.js";
import { logger } from "./logger.js";

/** Attach tools to the provided MCP server. */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "upsert_entity",
    {
      description:
        "Create or update an entity by name; fields omitted are left unchanged.",
      inputSchema: upsertSchema,
    },
    async (input): Promise<CallToolResult> => {
      try {
        await graph.upsertEntity(input);
        return { content: [{ type: "text", text: "success" }] };
      } catch (err) {
        logger.error("upsert_entity failed", err, input);
        return {
          content: [
            {
              type: "text",
              text: "Could not save to graph. Surface this to the user and let them decide how to proceed.",
            },
          ],
          isError: true,
        };
      }
    },
  );
}
