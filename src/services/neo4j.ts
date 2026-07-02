import { z } from "zod";
import neo4j, { type Driver } from "neo4j-driver";
import { needsImplicitTx } from "../errors.js";
import { relativeTime } from "../lib.js";
import { entitySchema, searchSchema, upsertSchema } from "../schema.js";
import { type Neo4jConfig } from "../types/configs.js";

export class Neo4jService {
  private constructor(private readonly driver: Driver) {}

  /** Connect and ensure the schema exists. */
  static async create(config: Neo4jConfig): Promise<Neo4jService> {
    const driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.user, config.password),
      { disableLosslessIntegers: true },
    );
    const service = new Neo4jService(driver);
    await service.ensureSchema();
    return service;
  }

  /** Close the driver and its connection pool. Call once on shutdown. */
  async close(): Promise<void> {
    await this.driver.close();
  }

  /** Run a Cypher statement and return its rows. */
  private async query(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>[]> {
    try {
      const { records } = await this.driver.executeQuery(cypher, params);
      return records.map((r) => r.toObject());
    } catch (err) {
      if (!needsImplicitTx(err)) throw err;
      const session = this.driver.session();
      try {
        const result = await session.run(cypher, params);
        return result.records.map((r) => r.toObject());
      } finally {
        // Best-effort cleanup: never let a close failure clobber the real result/error.
        await session.close().catch(() => {});
      }
    }
  }

  /** Create the constraints and indexes the graph relies on, if missing. */
  private async ensureSchema(): Promise<void> {
    await this.query(
      `CREATE CONSTRAINT entity_name IF NOT EXISTS
       FOR (e:Entity) REQUIRE e.name IS UNIQUE`,
    );
  }

  /** Create or update an entity by name; fields omitted are left unchanged. */
  async upsertEntity(input: z.infer<typeof upsertSchema>): Promise<void> {
    await this.query(
      `MERGE (e:Entity {name: $name})
       SET e.updated_at = $now,
           e.type = coalesce($type, e.type),
           e.summary = coalesce($summary, e.summary)`,
      {
        name: input.name,
        type: input.type ?? null,
        summary: input.summary ?? null,
        now: new Date().toISOString(),
      },
    );
  }

  /** Find entities whose name or type contains the query; lists recent entities when no query is given. */
  async searchEntities(
    input: z.infer<typeof searchSchema>,
    now: number = Date.now(),
  ): Promise<string> {
    const rows = await this.query(
      `MATCH (e:Entity)
       WHERE $query IS NULL
          OR toLower(e.name) CONTAINS toLower($query)
          OR toLower(coalesce(e.type, "")) CONTAINS toLower($query)
       RETURN e { .* } AS entity
       ORDER BY e.updated_at DESC
       LIMIT $limit`,
      { query: input.query ?? null, limit: neo4j.int(input.limit) },
    );
    const results = rows.map((r) => {
      const e = entitySchema.parse(r.entity);
      return {
        name: e.name,
        type: e.type,
        summary: e.summary,
        updated: relativeTime(e.updated_at, now),
      };
    });
    return JSON.stringify(results, null, 2);
  }
}
