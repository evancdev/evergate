import neo4j, { type Driver } from "neo4j-driver";
import { env } from "./env.js";

const driver: Driver = neo4j.driver(
  env.neo4j.uri,
  neo4j.auth.basic(env.neo4j.user, env.neo4j.password),
  { disableLosslessIntegers: true },
);

/** Close the driver and its connection pool. Call once on shutdown. */
export const closeDriver = (): Promise<void> => driver.close();
