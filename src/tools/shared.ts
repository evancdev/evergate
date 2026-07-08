import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Wrap a string as a successful tool result. */
export function formatText(body: string): CallToolResult {
  return { content: [{ type: "text", text: body }] };
}

/** Wrap an object as a tool result: `structuredContent` plus a JSON text mirror for content-only clients. */
export function formatStructured(
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return {
    structuredContent,
    content: [
      { type: "text", text: JSON.stringify(structuredContent, null, 2) },
    ],
  };
}

/** The response for any failed tool call; the specific cause is logged, not shown. */
export const FAILURE_RESPONSE: CallToolResult = {
  content: [
    {
      type: "text",
      text: "Tool failed. Surface this to the user and let them decide how to proceed.",
    },
  ],
  isError: true,
};
