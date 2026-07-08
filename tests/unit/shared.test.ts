import { describe, it, expect } from "vitest";
import {
  FAILURE_RESPONSE,
  formatStructured,
  formatText,
} from "../../src/tools/shared.js";

describe("formatText", () => {
  it("wraps its argument as a single text content block", () => {
    expect(formatText("any body here")).toEqual({
      content: [{ type: "text", text: "any body here" }],
    });
  });
});

describe("formatStructured", () => {
  it("returns structuredContent alongside a pretty-printed JSON text mirror", () => {
    const payload = { sessions: [{ session_id: "session-a" }] };
    expect(formatStructured(payload)).toEqual({
      structuredContent: payload,
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    });
  });

  it("keeps the text mirror in sync for an empty payload", () => {
    expect(formatStructured({ sessions: [] })).toEqual({
      structuredContent: { sessions: [] },
      content: [{ type: "text", text: '{\n  "sessions": []\n}' }],
    });
  });
});

describe("FAILURE_RESPONSE", () => {
  it("is a single error text block with the exact, cause-free message", () => {
    expect(FAILURE_RESPONSE.isError).toBe(true);
    expect(FAILURE_RESPONSE.content).toEqual([
      {
        type: "text",
        text: "Tool failed. Surface this to the user and let them decide how to proceed.",
      },
    ]);
  });
});
