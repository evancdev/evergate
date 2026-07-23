import neo4j, { type Driver, type EagerResult } from "neo4j-driver";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import { Neo4jService } from "@/services/neo4j";
import { type Neo4jConfig } from "@/types/configs";

/**
 * Test wrapper around Neo4jService: owns a throwaway container, the service under
 * test (`graph`), and a raw admin driver whose ops (seed/readNode/clear) set up and
 * verify state independently. Keep those trivial — sharing no logic with the service
 * is what makes them a valid oracle.
 */
export class Neo4jTestService {
  private constructor(
    private readonly container: StartedNeo4jContainer,
    private readonly admin: Driver,
    readonly graph: Neo4jService,
  ) {}

  /** Start a container, connect a raw admin driver, and build the service under test. */
  static async create(): Promise<Neo4jTestService> {
    // Must match the image in docker/compose.yml so tests run against prod's Neo4j.
    const container = await new Neo4jContainer("neo4j:5.26-community")
      .withPassword("testpassword")
      .start();
    const config: Neo4jConfig = {
      uri: container.getBoltUri(),
      user: container.getUsername(),
      password: container.getPassword(),
    };
    const admin = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.user, config.password),
      { disableLosslessIntegers: true },
    );
    const graph = await Neo4jService.create(config);
    return new Neo4jTestService(container, admin, graph);
  }

  /** Run raw Cypher via the admin driver. The one place that touches the driver. */
  async run(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<EagerResult> {
    return this.admin.executeQuery(cypher, params);
  }

  /** Delete every node and relationship. Schema (constraints/indexes) survives. */
  async clear(): Promise<void> {
    await this.run("MATCH (n) DETACH DELETE n");
  }

  /** Insert a node directly, bypassing the service, with known values. */
  async seed(props: {
    name: string;
    type?: string;
    summary?: string;
    updated_at?: string;
  }): Promise<void> {
    await this.run("CREATE (e:Entity) SET e = $props", {
      props: { updated_at: "2026-01-01T00:00:00.000Z", ...props },
    });
  }

  /** Read a node's properties directly, bypassing the service. */
  async readNode(name: string): Promise<Record<string, unknown> | undefined> {
    const { records } = await this.run(
      "MATCH (e:Entity {name: $name}) RETURN e { .* } AS entity",
      { name },
    );
    return records[0]?.get("entity") as Record<string, unknown> | undefined;
  }

  /** Close the service and admin driver, then stop the container. */
  async close(): Promise<void> {
    await Promise.all([this.graph.close(), this.admin.close()]);
    await this.container.stop();
  }
}
