import neo4j, { type Driver } from "neo4j-driver";
import { env } from "./env.js";
import { needsImplicitTx } from "./errors.js";

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
      await session.close();
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
