import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IsomorphicHeaders } from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "@/tools/index";

// Registering tools must not trigger the eager Neo4j connect in the real services module.
vi.mock("@/services/index", () => ({ services: {} }));

// A stand-in server that only records the names it is asked to register.
function registeredNames(headers: IsomorphicHeaders | undefined): string[] {
  const names: string[] = [];
  const server = {
    registerTool: (name: string) => names.push(name),
  } as unknown as McpServer;
  registerTools(server, headers);
  return names;
}

describe("registerTools", () => {
  it("always registers the identity-free graph tools", () => {
    expect(registeredNames({})).toEqual(
      expect.arrayContaining([
        "upsert_entity",
        "list_types",
        "search_entities",
      ]),
    );
  });

  it("omits the wrapped-only presence tools when no terminal id is present", () => {
    const names = registeredNames({});
    expect(names).not.toContain("update_session");
    expect(names).not.toContain("list_sessions");
    expect(names).not.toContain("send_message");
  });

  it("registers the presence tools when the request carries a terminal id", () => {
    expect(registeredNames({ "x-hermes-terminal": "term-a" })).toEqual(
      expect.arrayContaining([
        "update_session",
        "list_sessions",
        "send_message",
      ]),
    );
  });
});
