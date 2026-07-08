import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { services } from "@/services/index";
import { listSchema, searchSchema, upsertSchema } from "@/schemas/neo4j";
import { logger } from "@/logger";
import { FAILURE_RESPONSE, formatText } from "@/tools/shared";

/** Attach the Neo4j knowledge-graph tools to the MCP server. */
export function registerNeo4jTools(server: McpServer): void {
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
        return formatText("success");
      } catch (err) {
        logger.error("upsert_entity failed", err, input);
        return FAILURE_RESPONSE;
      }
    },
  );

  server.registerTool(
    "list_types",
    {
      description:
        "List the types in use, or pass a type to list its entities.",
      inputSchema: listSchema,
    },
    async (input): Promise<CallToolResult> => {
      try {
        const result = await services.neo4j.list(input);
        return formatText(result);
      } catch (err) {
        logger.error("list_types failed", err, input);
        return FAILURE_RESPONSE;
      }
    },
  );

  server.registerTool(
    "search_entities",
    {
      description:
        "Search entities by name; lists recent entities when no query is provided.",
      inputSchema: searchSchema,
    },
    async (input): Promise<CallToolResult> => {
      try {
        const result = await services.neo4j.searchEntities(input);
        return formatText(result);
      } catch (err) {
        logger.error("search_entities failed", err, input);
        return FAILURE_RESPONSE;
      }
    },
  );
}
