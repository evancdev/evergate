import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { type Neo4jService } from "@/services/neo4j";
import { type Neo4jTestService } from "@tests/harness/neo4j";
import { TestingHarness } from "@tests/harness/index";
import { sleep } from "@tests/lib";

let harness: TestingHarness;
let test: Neo4jTestService;
let prod: Neo4jService;

const NOW = new Date("2026-01-08T00:00:00.000Z").getTime();

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
    // No clock passed: the just-written row is seconds old, so "just now".
    expect(await prod.searchEntities({ query: "Neo4j", limit: 100 })).toBe(
      `[
  {
    "name": "Neo4j",
    "type": "database",
    "updated": "just now"
  }
]`,
    );
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

  it("normalizes the type (trim + lowercase) on write", async () => {
    await prod.upsertEntity({ name: "Neo4j", type: "  DataBase  " });
    const e = await test.readNode("Neo4j");
    expect(e).toMatchObject({ type: "database" });
  });

  it("drops a blank (whitespace-only) type rather than storing an empty string", async () => {
    await prod.upsertEntity({ name: "Blank", type: "   " });
    const e = await test.readNode("Blank");
    expect(e).not.toHaveProperty("type");
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
    await test.seed({
      name: "Neo4j",
      type: "database",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(await prod.searchEntities({ query: "NEO", limit: 100 }, NOW)).toBe(
      `[
  {
    "name": "Neo4j",
    "type": "database",
    "updated": "7 days ago"
  }
]`,
    );
  });

  it("does not match on summary", async () => {
    await test.seed({
      name: "Widget",
      type: "thing",
      summary: "mentions a unicorn",
    });
    expect(
      await prod.searchEntities({ query: "unicorn", limit: 100 }, NOW),
    ).toBe("[]");
  });

  it("does not match on type (that is list_types' job)", async () => {
    await test.seed({ name: "Neo4j", type: "database" });
    expect(
      await prod.searchEntities({ query: "database", limit: 100 }, NOW),
    ).toBe("[]");
  });

  it("lists all entities when no query is given", async () => {
    await test.seed({ name: "One", updated_at: "2026-01-03T00:00:00.000Z" });
    await test.seed({ name: "Two", updated_at: "2026-01-02T00:00:00.000Z" });
    await test.seed({ name: "Three", updated_at: "2026-01-01T00:00:00.000Z" });
    expect(await prod.searchEntities({ limit: 100 }, NOW)).toBe(
      `[
  {
    "name": "One",
    "updated": "5 days ago"
  },
  {
    "name": "Two",
    "updated": "6 days ago"
  },
  {
    "name": "Three",
    "updated": "7 days ago"
  }
]`,
    );
  });

  it("caps results at the limit", async () => {
    await test.seed({ name: "One", updated_at: "2026-01-03T00:00:00.000Z" });
    await test.seed({ name: "Two", updated_at: "2026-01-02T00:00:00.000Z" });
    await test.seed({ name: "Three", updated_at: "2026-01-01T00:00:00.000Z" });
    // A plain number would pack as a float and Neo4j would reject it for LIMIT.
    expect(await prod.searchEntities({ limit: 2 }, NOW)).toBe(
      `[
  {
    "name": "One",
    "updated": "5 days ago"
  },
  {
    "name": "Two",
    "updated": "6 days ago"
  }
]`,
    );
  });

  it("orders most-recently-updated first", async () => {
    await test.seed({ name: "Beta", updated_at: "2026-01-01T00:00:00.000Z" });
    await test.seed({ name: "Alpha", updated_at: "2026-01-02T00:00:00.000Z" });
    expect(await prod.searchEntities({ limit: 100 }, NOW)).toBe(
      `[
  {
    "name": "Alpha",
    "updated": "6 days ago"
  },
  {
    "name": "Beta",
    "updated": "7 days ago"
  }
]`,
    );
  });

  it("returns the most-recently-updated entities up to the limit, in order", async () => {
    // Timestamps ascend while names are out of alphabetical order, so a broken
    // ORDER BY or an arbitrary LIMIT can't pass by coincidence.
    await test.seed({ name: "First", updated_at: "2026-01-01T00:00:00.000Z" });
    await test.seed({ name: "Second", updated_at: "2026-01-02T00:00:00.000Z" });
    await test.seed({ name: "Third", updated_at: "2026-01-03T00:00:00.000Z" });
    expect(await prod.searchEntities({ limit: 2 }, NOW)).toBe(
      `[
  {
    "name": "Third",
    "updated": "5 days ago"
  },
  {
    "name": "Second",
    "updated": "6 days ago"
  }
]`,
    );
  });

  it("returns nothing when the graph is empty", async () => {
    expect(await prod.searchEntities({ limit: 100 }, NOW)).toBe("[]");
    expect(
      await prod.searchEntities({ query: "anything", limit: 100 }, NOW),
    ).toBe("[]");
  });

  it("matches a type-less entity on its name (coalesce guards the null type)", async () => {
    await test.seed({ name: "Solo", updated_at: "2026-01-01T00:00:00.000Z" });
    expect(await prod.searchEntities({ query: "Solo", limit: 100 }, NOW)).toBe(
      `[
  {
    "name": "Solo",
    "updated": "7 days ago"
  }
]`,
    );
  });

  it("applies the query filter, ordering, and limit together", async () => {
    // "Newest" is the most recent row but doesn't match the query: proof the
    // filter runs before ORDER BY + LIMIT.
    await test.seed({
      name: "alpha-node",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    await test.seed({
      name: "beta-node",
      updated_at: "2026-01-02T00:00:00.000Z",
    });
    await test.seed({
      name: "gamma-node",
      updated_at: "2026-01-03T00:00:00.000Z",
    });
    await test.seed({ name: "Newest", updated_at: "2026-01-04T00:00:00.000Z" });
    expect(await prod.searchEntities({ query: "node", limit: 2 }, NOW)).toBe(
      `[
  {
    "name": "gamma-node",
    "updated": "5 days ago"
  },
  {
    "name": "beta-node",
    "updated": "6 days ago"
  }
]`,
    );
  });
});

describe("list without a type (vocabulary)", () => {
  it("lists each distinct type once, ordered by type", async () => {
    await test.seed({ name: "Postgres", type: "database" });
    await test.seed({ name: "Neo4j", type: "database" });
    await test.seed({ name: "Cypher", type: "language" });
    expect(await prod.list({})).toBe("database\nlanguage");
  });

  it("omits untyped entities from the vocabulary", async () => {
    await test.seed({ name: "Neo4j", type: "database" });
    await test.seed({ name: "Cypher", type: "language" });
    await test.seed({ name: "Solo" });
    await test.seed({ name: "Duo" });
    expect(await prod.list({})).toBe("database\nlanguage");
  });

  it("reports no types when every entity is untyped", async () => {
    await test.seed({ name: "Solo" });
    await test.seed({ name: "Duo" });
    expect(await prod.list({})).toBe("No types yet.");
  });

  it("reports no types when the graph is empty", async () => {
    expect(await prod.list({})).toBe("No types yet.");
  });
});

describe("list with a type (drill-in)", () => {
  it("lists that type's entity names, ordered by name", async () => {
    await test.seed({ name: "Postgres", type: "database" });
    await test.seed({ name: "Neo4j", type: "database" });
    await test.seed({ name: "Cypher", type: "language" });
    expect(await prod.list({ type: "database" })).toBe("Neo4j\nPostgres");
  });

  it("matches the type case-sensitively at the storage layer", async () => {
    await test.seed({ name: "Neo4j", type: "database" });
    await test.seed({ name: "Mongo", type: "Database" });
    expect(await prod.list({ type: "database" })).toBe("Neo4j");
  });

  it("normalizes the queried type (trim + lowercase)", async () => {
    await test.seed({ name: "Neo4j", type: "database" });
    expect(await prod.list({ type: "  DATABASE  " })).toBe("Neo4j");
  });

  it("reports a type with no entities", async () => {
    expect(await prod.list({ type: "nonexistent" })).toBe(
      'No entities of type "nonexistent".',
    );
  });

  it("treats a whitespace-only type as no type and lists the vocabulary", async () => {
    await test.seed({ name: "Neo4j", type: "database" });
    await test.seed({ name: "Cypher", type: "language" });
    expect(await prod.list({ type: "   " })).toBe("database\nlanguage");
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
    // No clock passed: the just-written row is seconds old, so "just now".
    expect(await prod.searchEntities({ query: "Roundtrip", limit: 100 })).toBe(
      `[
  {
    "name": "Roundtrip",
    "type": "database",
    "summary": "written by upsert, read by search",
    "updated": "just now"
  }
]`,
    );
  });
});

describe("schema", () => {
  it("enforces a uniqueness constraint on entity name", async () => {
    // Raw CREATE bypasses upsert's MERGE, so the constraint is what must reject the duplicate.
    await test.run("CREATE (:Entity {name: 'Dup'})");
    await expect(test.run("CREATE (:Entity {name: 'Dup'})")).rejects.toThrow();
  });
});
