import { z } from "zod";
import neo4j, { type Driver } from "neo4j-driver";
import { env } from "./env.js";
import { needsImplicitTx } from "./errors.js";
import { upsertSchema } from "./schema.js";

const driver: Driver = neo4j.driver(
  env.neo4j.uri,
  neo4j.auth.basic(env.neo4j.user, env.neo4j.password),
  { disableLosslessIntegers: true },
);

/** Close the driver and its connection pool. Call once on shutdown. */
export const closeDriver = (): Promise<void> => driver.close();

/** Run a Cypher statement and return its rows. */
async function query(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  try {
    const { records } = await driver.executeQuery(cypher, params);
    return records.map((r) => r.toObject());
  } catch (err) {
    if (!needsImplicitTx(err)) throw err;
    const session = driver.session();
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
export async function ensureSchema(): Promise<void> {
  await query(
    `CREATE CONSTRAINT entity_name IF NOT EXISTS
     FOR (e:Entity) REQUIRE e.name IS UNIQUE`,
  );
}

/** Create or update an entity by name; fields omitted are left unchanged. */
export async function upsertEntity(input: z.infer<typeof upsertSchema>): Promise<void> {
  await query(
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
