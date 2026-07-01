import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { type Neo4jService } from "../../src/services/neo4j.js";
import { type Neo4jTestService } from "../harness/neo4j.js";
import { TestingHarness } from "../harness/index.js";
import { sleep } from "../lib.js";

let harness: TestingHarness;
let test: Neo4jTestService;
let prod: Neo4jService;

beforeAll(async () => {
  harness = await TestingHarness.create();
  test = harness.neo4j;
  prod = test.graph;
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await test.clear();
});

describe("upsertEntity", () => {
  it("creates an entity with all fields and an ISO updated_at", async () => {
    await prod.upsertEntity({
      name: "Neo4j",
      type: "database",
      summary: "A graph database.",
    });
    const e = await test.readNode("Neo4j");
    expect(e).toMatchObject({
      name: "Neo4j",
      type: "database",
      summary: "A graph database.",
    });
    expect(e?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("is idempotent: the same name never creates a second node", async () => {
    await prod.upsertEntity({ name: "Neo4j", type: "database" });
    await prod.upsertEntity({ name: "Neo4j", type: "database" });
    const rows = await prod.searchEntities({ query: "Neo4j", limit: 100 });
    expect(rows).toHaveLength(1);
  });

  it("leaves omitted fields unchanged (coalesce keeps existing values)", async () => {
    await prod.upsertEntity({
      name: "Neo4j",
      type: "database",
      summary: "A graph database.",
    });
    await prod.upsertEntity({ name: "Neo4j" });
    const e = await test.readNode("Neo4j");
    expect(e).toMatchObject({ type: "database", summary: "A graph database." });
  });

  it("overwrites only the fields that are provided", async () => {
    await prod.upsertEntity({
      name: "Neo4j",
      type: "database",
      summary: "old summary",
    });
    await prod.upsertEntity({ name: "Neo4j", summary: "new summary" });
    const e = await test.readNode("Neo4j");
    expect(e).toMatchObject({ type: "database", summary: "new summary" });
  });

  it("stores no type or summary property when only a name is given", async () => {
    await prod.upsertEntity({ name: "Bare" });
    const e = await test.readNode("Bare");
    // coalesce(null, null) is null, and Cypher SET x = null removes the property.
    expect(e).toMatchObject({ name: "Bare" });
    expect(e).not.toHaveProperty("type");
    expect(e).not.toHaveProperty("summary");
  });

  it("refreshes updated_at on every update", async () => {
    await prod.upsertEntity({ name: "Neo4j", type: "database" });
    const before = await test.readNode("Neo4j");
    await sleep(5);
    await prod.upsertEntity({ name: "Neo4j", type: "database" });
    const after = await test.readNode("Neo4j");
    // A MERGE refactor to ON CREATE SET would freeze this; a re-upsert must move it forward.
    const t1 = new Date(before?.updated_at as string).getTime();
    const t2 = new Date(after?.updated_at as string).getTime();
    expect(t2).toBeGreaterThan(t1);
  });
});

describe("searchEntities", () => {
  it("matches on name, case-insensitively", async () => {
    await test.seed({ name: "Neo4j", type: "database" });
    const rows = await prod.searchEntities({ query: "NEO", limit: 100 });
    expect(rows.map((r) => r.name)).toContain("Neo4j");
  });

  it("matches on type", async () => {
    await test.seed({ name: "Neo4j", type: "database" });
    await test.seed({ name: "Cypher", type: "language" });
    const rows = await prod.searchEntities({ query: "data", limit: 100 });
    expect(rows.map((r) => r.name)).toEqual(["Neo4j"]);
  });

  it("does not match on summary", async () => {
    await test.seed({
      name: "Widget",
      type: "thing",
      summary: "mentions a unicorn",
    });
    const rows = await prod.searchEntities({ query: "unicorn", limit: 100 });
    expect(rows).toHaveLength(0);
  });

  it("lists all entities when no query is given", async () => {
    await test.seed({ name: "One" });
    await test.seed({ name: "Two" });
    await test.seed({ name: "Three" });
    const rows = await prod.searchEntities({ limit: 100 });
    expect(rows).toHaveLength(3);
  });

  it("caps results at the limit", async () => {
    await test.seed({ name: "One" });
    await test.seed({ name: "Two" });
    await test.seed({ name: "Three" });
    // A plain number would pack as a float and Neo4j would reject it for LIMIT.
    const rows = await prod.searchEntities({ limit: 2 });
    expect(rows).toHaveLength(2);
  });

  it("orders most-recently-updated first", async () => {
    await test.seed({
      name: "Beta",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    await test.seed({
      name: "Alpha",
      updated_at: "2026-01-02T00:00:00.000Z",
    });
    const rows = await prod.searchEntities({ limit: 100 });
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
  });

  it("returns the most-recently-updated entities up to the limit, in order", async () => {
    // Timestamps ascend while names are out of alphabetical order, so a broken
    // ORDER BY or an arbitrary LIMIT can't pass by coincidence.
    await test.seed({
      name: "First",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    await test.seed({
      name: "Second",
      updated_at: "2026-01-02T00:00:00.000Z",
    });
    await test.seed({
      name: "Third",
      updated_at: "2026-01-03T00:00:00.000Z",
    });
    const rows = await prod.searchEntities({ limit: 2 });
    expect(rows.map((r) => r.name)).toEqual(["Third", "Second"]);
  });

  it("returns nothing when the graph is empty", async () => {
    expect(await prod.searchEntities({ limit: 100 })).toEqual([]);
    expect(
      await prod.searchEntities({ query: "anything", limit: 100 }),
    ).toEqual([]);
  });

  it("matches a type-less entity on its name (coalesce guards the null type)", async () => {
    await test.seed({ name: "Solo" });
    const rows = await prod.searchEntities({ query: "Solo", limit: 100 });
    expect(rows.map((r) => r.name)).toEqual(["Solo"]);
  });

  it("matches on type case-insensitively on the stored side too", async () => {
    await test.seed({ name: "PG", type: "Database" });
    const rows = await prod.searchEntities({ query: "database", limit: 100 });
    expect(rows.map((r) => r.name)).toContain("PG");
  });

  it("applies the query filter, ordering, and limit together", async () => {
    // "Other" is the newest row but the wrong type: proof the filter runs before ORDER BY + LIMIT.
    await test.seed({
      name: "Old",
      type: "database",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    await test.seed({
      name: "Mid",
      type: "database",
      updated_at: "2026-01-02T00:00:00.000Z",
    });
    await test.seed({
      name: "New",
      type: "database",
      updated_at: "2026-01-03T00:00:00.000Z",
    });
    await test.seed({
      name: "Other",
      type: "language",
      updated_at: "2026-01-04T00:00:00.000Z",
    });
    const rows = await prod.searchEntities({ query: "database", limit: 2 });
    expect(rows.map((r) => r.name)).toEqual(["New", "Mid"]);
  });
});

describe("round-trip", () => {
  // Both operations are independently grounded above (writes via readNode, reads
  // via seed); this is a deliberate smoke check that they agree end to end.
  it("an entity written by upsert is found by a later search", async () => {
    await prod.upsertEntity({
      name: "Roundtrip",
      type: "database",
      summary: "written by upsert, read by search",
    });
    const rows = await prod.searchEntities({ query: "Roundtrip", limit: 100 });
    expect(rows.map((r) => r.name)).toContain("Roundtrip");
  });
});

describe("schema", () => {
  it("enforces a uniqueness constraint on entity name", async () => {
    // Raw CREATE bypasses upsert's MERGE, so the constraint is what must reject the duplicate.
    await test.run("CREATE (:Entity {name: 'Dup'})");
    await expect(test.run("CREATE (:Entity {name: 'Dup'})")).rejects.toThrow();
  });
});
