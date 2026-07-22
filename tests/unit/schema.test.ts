import { describe, it, expect } from "vitest";
import { z } from "zod";
import { upsertSchema, searchSchema, listSchema } from "@/schemas/neo4j";
import {
  updateSessionSchema,
  setStatusSchema,
  setSessionSchema,
  listSessionsOutputSchema,
} from "@/schemas/hermes";

describe("upsertSchema", () => {
  it("accepts a name on its own (type and summary are optional)", () => {
    expect(upsertSchema.safeParse({ name: "Neo4j" }).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(upsertSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects empty type or summary strings", () => {
    expect(upsertSchema.safeParse({ name: "X", type: "" }).success).toBe(false);
    expect(upsertSchema.safeParse({ name: "X", summary: "" }).success).toBe(
      false,
    );
  });
});

describe("listSchema", () => {
  it("accepts an empty input (type is optional)", () => {
    expect(listSchema.parse({})).toEqual({});
  });

  it("rejects an empty type string", () => {
    expect(listSchema.safeParse({ type: "" }).success).toBe(false);
  });
});

describe("searchSchema", () => {
  it("defaults limit to 10 when omitted", () => {
    expect(searchSchema.parse({})).toEqual({ limit: 10 });
  });

  it("rejects a limit above 100", () => {
    expect(searchSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("rejects a non-positive limit", () => {
    expect(searchSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it("rejects a non-integer limit", () => {
    expect(searchSchema.safeParse({ limit: 1.5 }).success).toBe(false);
  });

  it("rejects an empty query string", () => {
    expect(searchSchema.safeParse({ query: "" }).success).toBe(false);
  });
});

describe("updateSessionSchema", () => {
  it("accepts a non-empty description", () => {
    expect(
      updateSessionSchema.safeParse({ description: "building the api" })
        .success,
    ).toBe(true);
  });

  it("rejects a missing description", () => {
    expect(updateSessionSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a non-string description", () => {
    expect(updateSessionSchema.safeParse({ description: 123 }).success).toBe(
      false,
    );
  });

  it("rejects an empty or whitespace-only description", () => {
    expect(updateSessionSchema.safeParse({ description: "" }).success).toBe(
      false,
    );
    expect(updateSessionSchema.safeParse({ description: "   " }).success).toBe(
      false,
    );
  });

  it("trims the stored description", () => {
    expect(updateSessionSchema.parse({ description: "  hi  " })).toEqual({
      description: "hi",
    });
  });

  it("trims before the min-length check at the boundary", () => {
    expect(updateSessionSchema.parse({ description: " a " })).toEqual({
      description: "a",
    });
  });
});

describe("setStatusSchema", () => {
  it("accepts busy and idle", () => {
    expect(setStatusSchema.safeParse({ status: "busy" }).success).toBe(true);
    expect(setStatusSchema.safeParse({ status: "idle" }).success).toBe(true);
  });

  it("rejects any other status and a missing one", () => {
    expect(setStatusSchema.safeParse({ status: "working" }).success).toBe(
      false,
    );
    expect(setStatusSchema.safeParse({}).success).toBe(false);
  });
});

describe("setSessionSchema", () => {
  it("accepts a non-empty session_id and trims it", () => {
    expect(setSessionSchema.parse({ session_id: "  sess-a  " })).toEqual({
      session_id: "sess-a",
    });
  });

  it("rejects a missing or empty session_id", () => {
    expect(setSessionSchema.safeParse({}).success).toBe(false);
    expect(setSessionSchema.safeParse({ session_id: "   " }).success).toBe(
      false,
    );
  });
});

describe("listSessionsOutputSchema", () => {
  const schema = z.object(listSessionsOutputSchema);

  it("accepts a well-formed list_sessions payload", () => {
    expect(
      schema.safeParse({
        sessions: [
          {
            session_id: "s1",
            description: "one",
            last_seen: "just now",
            status: "idle",
          },
        ],
        messages: [{ from: "s2", message: "hi", at: "just now" }],
      }).success,
    ).toBe(true);
  });

  it("accepts empty sessions and messages arrays", () => {
    expect(schema.safeParse({ sessions: [], messages: [] }).success).toBe(true);
  });

  it("rejects a session missing a required field", () => {
    expect(
      schema.safeParse({
        sessions: [{ session_id: "s1", last_seen: "x" }],
        messages: [],
      }).success,
    ).toBe(false);
  });

  it("rejects a message missing a required field", () => {
    expect(
      schema.safeParse({
        sessions: [],
        messages: [{ from: "s2", message: "hi" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a missing sessions array", () => {
    expect(schema.safeParse({ messages: [] }).success).toBe(false);
  });

  it("rejects a missing messages array", () => {
    expect(schema.safeParse({ sessions: [] }).success).toBe(false);
  });
});
