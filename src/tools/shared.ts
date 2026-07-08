import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Wrap a string as a successful tool result. */
export function formatTool(body: string): CallToolResult {
  return { content: [{ type: "text", text: body }] };
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
