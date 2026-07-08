import { Neo4jTestService } from "@tests/harness/neo4j";

/**
 * Test-side composition root: starts every test service against its own throwaway
 * container.
 */
export class TestingHarness {
  private constructor(readonly neo4j: Neo4jTestService) {}

  static async create(): Promise<TestingHarness> {
    const neo4j = await Neo4jTestService.create();
    return new TestingHarness(neo4j);
  }

  /** Tear down every test service. */
  async close(): Promise<void> {
    await this.neo4j.close();
  }
}
