import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { services } from "./services/index.js";
import { searchSchema, upsertSchema } from "./schema.js";
import { relativeTime } from "./lib.js";
import { logger } from "./logger.js";

/** The response for any failed tool call; the specific cause is logged, not shown. */
const FAILURE_RESPONSE: CallToolResult = {
  content: [
    {
      type: "text",
      text: "Tool failed. Surface this to the user and let them decide how to proceed.",
    },
  ],
  isError: true,
};

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
        await services.neo4j.upsertEntity(input);
        return { content: [{ type: "text", text: "success" }] };
      } catch (err) {
        logger.error("upsert_entity failed", err, input);
        return FAILURE_RESPONSE;
      }
    },
  );

  server.registerTool(
    "search_entities",
    {
      description:
        "Search entities by text across name and type; lists recent entities when no query is provided.",
      inputSchema: searchSchema,
    },
    async (input): Promise<CallToolResult> => {
      try {
        const entities = await services.neo4j.searchEntities(input);
        const results = entities.map(({ updated_at, ...entity }) => ({
          ...entity,
          updated: relativeTime(updated_at as string),
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      } catch (err) {
        logger.error("search_entities failed", err, input);
        return FAILURE_RESPONSE;
      }
    },
  );
}
