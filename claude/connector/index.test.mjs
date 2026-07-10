import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONNECTOR = fileURLToPath(new URL("./index.mjs", import.meta.url));

// A minimal stateless MCP endpoint exposing one `ping` tool; records the identity header seen
// on /mcp and every /hermes/{register,deregister} call (as {path, id}).
function startMockServer() {
  const seen = [];
  const presence = [];
  const server = createServer(async (req, res) => {
    const id = req.headers["x-hermes-agent"];
    const hermes = req.method === "POST" && /^\/hermes\/(register|deregister)$/.exec(req.url ?? "");
    if (hermes) {
      presence.push({ path: hermes[1], id });
      res.writeHead(204).end();
      return;
    }
    if (req.method !== "POST" || !req.url?.startsWith("/mcp")) {
      res.writeHead(404).end();
      return;
    }
    seen.push(id);
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const mcp = new McpServer({ name: "mock", version: "0.0.0" });
    mcp.registerTool("ping", { description: "ping" }, () => ({
      content: [{ type: "text", text: "pong" }],
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, seen, presence, close: () => server.close() });
    });
  });
}

// Spawn the connector as Claude would, with the given env, and return a connected MCP client.
// An override set to `undefined` removes that variable from the child's environment.
async function connect(env) {
  const merged = { ...process.env, ...env };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete merged[key];
  const transport = new StdioClientTransport({
    command: "node",
    args: [CONNECTOR],
    env: merged,
    stderr: "ignore",
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

let mock;
before(async () => { mock = await startMockServer(); });
after(() => mock.close());

test("bridges JSON-RPC: tools list and call round-trip through the connector", async () => {
  const client = await connect({ EVERGATE_URL: mock.url, CLAUDE_CODE_SESSION_ID: "sess-1" });
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["ping"]);
    const result = await client.callTool({ name: "ping" });
    assert.equal(result.content[0].text, "pong");
  } finally {
    await client.close();
  }
});

test("stamps X-Hermes-Agent from CLAUDE_CODE_SESSION_ID on every request", async () => {
  const before = mock.seen.length;
  const client = await connect({ EVERGATE_URL: mock.url, CLAUDE_CODE_SESSION_ID: "sess-2" });
  try {
    await client.listTools();
  } finally {
    await client.close();
  }
  const seen = mock.seen.slice(before);
  assert.ok(seen.length > 0, "server received at least one request");
  assert.ok(seen.every((h) => h === "sess-2"), `all requests carry the id, got ${seen}`);
});

test("falls back to a stable generated id when CLAUDE_CODE_SESSION_ID is unset", async () => {
  const before = mock.seen.length;
  const client = await connect({ EVERGATE_URL: mock.url, CLAUDE_CODE_SESSION_ID: undefined });
  try {
    await client.listTools();
    await client.callTool({ name: "ping" });
  } finally {
    await client.close();
  }
  const seen = mock.seen.slice(before);
  assert.ok(seen.length > 1, "server received multiple requests");
  assert.ok(seen.every((h) => typeof h === "string" && h.length > 0), "a non-empty id is stamped");
  assert.equal(new Set(seen).size, 1, `the same id is reused across requests, got ${[...new Set(seen)]}`);
});

// Poll until `predicate` holds or the deadline passes; returns the predicate's truthy value.
async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("registers the session on start and deregisters it on exit", async () => {
  const client = await connect({ EVERGATE_URL: mock.url, CLAUDE_CODE_SESSION_ID: "sess-life" });
  const registered = await waitFor(() =>
    mock.presence.find((p) => p.path === "register" && p.id === "sess-life"),
  );
  assert.ok(registered, "server saw a register for the session on start");

  await client.close();
  const deregistered = await waitFor(() =>
    mock.presence.find((p) => p.path === "deregister" && p.id === "sess-life"),
  );
  assert.ok(deregistered, "server saw a deregister for the session on exit");
});

// A URL nothing is listening on: bind an ephemeral port, then free it.
function unusedUrl() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(`http://127.0.0.1:${port}`));
    });
  });
}

test("answers with an error instead of hanging when the server is unreachable", async () => {
  const transport = new StdioClientTransport({
    command: "node",
    args: [CONNECTOR],
    env: { ...process.env, EVERGATE_URL: await unusedUrl(), CLAUDE_CODE_SESSION_ID: "sess-dead" },
    stderr: "ignore",
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await assert.rejects(
    client.connect(transport),
    (err) => err.code === -32001 || String(err.message).includes("connector"),
    "initialize is answered with a connector error rather than left to time out",
  );
  await client.close().catch(() => {});
});
