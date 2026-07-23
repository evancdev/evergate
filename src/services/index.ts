import { env } from "@/env";
import { logger } from "@/logger";
import { Hermes } from "@/services/hermes";
import { Neo4jService } from "@/services/neo4j";

/** Owns every long-lived service. Built once at startup; create() throws if any fail. */
export class Services {
  private constructor(
    readonly neo4j: Neo4jService,
    readonly hermes: Hermes,
  ) {}

  static async create(): Promise<Services> {
    const neo4j = await Neo4jService.create(env.neo4j);
    const hermes = Hermes.create(env.hermes);
    return new Services(neo4j, hermes);
  }

  /** Release every service. Call once on shutdown, after HTTP has drained. */
  async close(): Promise<void> {
    await this.neo4j.close();
    this.hermes.close();
  }
}

// Connected at import time; a failure here is fatal, so log it and exit.
async function connect(): Promise<Services> {
  try {
    const services = await Services.create();
    logger.info("Services ready");
    return services;
  } catch (err) {
    logger.error("Failed to initialize services", err);
    process.exit(1);
  }
}

// Eager singleton: importing this connects to Neo4j. Import only from src/.
export const services = await connect();
