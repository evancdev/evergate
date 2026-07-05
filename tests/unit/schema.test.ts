import { describe, it, expect } from "vitest";
import { upsertSchema, searchSchema, listSchema } from "../../src/schema.js";

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
