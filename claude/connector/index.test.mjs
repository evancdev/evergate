import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createServer as createUnixServer } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONNECTOR = fileURLToPath(new URL("./index.mjs", import.meta.url));

// Minimal MCP mock: serves `ping` always, `list_sessions` only with a terminal header; records terminal headers on /mcp and presence calls.
function startMockServer() {
  const seen = []; // x-hermes-terminal seen on each /mcp request
  const presence = []; // {path, term} for each /hermes/{register,deregister}
  const pull = []; // messages the idle-poller will drain, one batch per /hermes/pull
  const server = createServer(async (req, res) => {
    const term = req.headers["x-hermes-terminal"];
    if (req.method === "POST" && req.url === "/hermes/pull") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ messages: pull.splice(0) }));
      return;
    }
    const hermes =
      req.method === "POST" &&
      /^\/hermes\/(register|deregister)$/.exec(req.url ?? "");
    if (hermes) {
      presence.push({ path: hermes[1], term });
      res.writeHead(204).end();
      return;
    }
    if (req.method !== "POST" || !req.url?.startsWith("/mcp")) {
      res.writeHead(404).end();
      return;
    }
    seen.push(term);
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const mcp = new McpServer({ name: "mock", version: "0.0.0" });
    mcp.registerTool("ping", { description: "ping" }, () => ({
      content: [{ type: "text", text: "pong" }],
    }));
    // Presence tool is wrapped-only: served only when the caller sent a terminal id.
    if (term)
      mcp.registerTool("list_sessions", { description: "presence" }, () => ({
        content: [{ type: "text", text: "[]" }],
      }));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        presence,
        pull,
        close: () => server.close(),
      });
    });
  });
}

// Spawn the connector as Claude would and return a connected MCP client; an env override of `undefined` unsets that variable.
async function connect(env) {
  const merged = { ...process.env, ...env };
  // Strip inherited identity/inject vars so a wrapped dev session doesn't skew tests; each test sets its own.
  for (const key of ["HERMES_INJECT_SOCK", "HERMES_TERMINAL_ID"])
    if (!(key in env)) delete merged[key];
  for (const key of Object.keys(env))
    if (env[key] === undefined) delete merged[key];
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
before(async () => {
  mock = await startMockServer();
});
after(() => mock.close());

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

test("bridges JSON-RPC: a tool call round-trips through the connector", async () => {
  const client = await connect({ EVERGATE_URL: mock.url });
  try {
    const result = await client.callTool({ name: "ping" });
    assert.equal(result.content[0].text, "pong");
  } finally {
    await client.close();
  }
});

test("starts and serves the graph tools even without the wrapper", async () => {
  // No HERMES_TERMINAL_ID: the connector must still come up (it no longer refuses) and bridge tools.
  const client = await connect({ EVERGATE_URL: mock.url });
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes("ping"), "graph/other tools are served unwrapped");
  } finally {
    await client.close();
  }
});

test("hides the Hermes presence tools from tools/list when unwrapped", async () => {
  const client = await connect({ EVERGATE_URL: mock.url });
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes("ping"));
    assert.ok(
      !names.includes("list_sessions"),
      "the server omits the presence tool when we send no terminal id",
    );
  } finally {
    await client.close();
  }
});

test("exposes the Hermes presence tools when wrapped", async () => {
  const client = await connect({
    EVERGATE_URL: mock.url,
    HERMES_TERMINAL_ID: "term-tools",
  });
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(
      names.includes("ping") && names.includes("list_sessions"),
      "a wrapped session sees the presence tools",
    );
  } finally {
    await client.close();
  }
});

test("does not register presence when unwrapped", async () => {
  const before = mock.presence.length;
  const client = await connect({ EVERGATE_URL: mock.url });
  try {
    // Give it well past the point it would have registered had it been going to.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(
      mock.presence.length,
      before,
      "an unwrapped session announces no presence",
    );
  } finally {
    await client.close();
  }
});

test("registers on start and deregisters on exit, keyed by the terminal id", async () => {
  const client = await connect({
    EVERGATE_URL: mock.url,
    HERMES_TERMINAL_ID: "term-life",
  });
  const registered = await waitFor(() =>
    mock.presence.find((p) => p.path === "register" && p.term === "term-life"),
  );
  assert.ok(registered, "server saw a register keyed by the terminal on start");

  await client.close();
  const deregistered = await waitFor(() =>
    mock.presence.find(
      (p) => p.path === "deregister" && p.term === "term-life",
    ),
  );
  assert.ok(deregistered, "server saw a deregister for the terminal on exit");
});

test("stamps the stable X-Hermes-Terminal header on server calls when wrapped", async () => {
  const before = mock.seen.length;
  const client = await connect({
    EVERGATE_URL: mock.url,
    HERMES_TERMINAL_ID: "terminal-xyz",
  });
  try {
    await client.listTools();
  } finally {
    await client.close();
  }
  const seen = mock.seen.slice(before);
  assert.ok(seen.length > 0, "server received at least one request");
  assert.ok(
    seen.every((t) => t === "terminal-xyz"),
    `every request carries the terminal id, got ${seen}`,
  );
});

test("heartbeats register on an interval so the session stays fresh", async () => {
  const before = mock.presence.filter((p) => p.path === "register").length;
  const client = await connect({
    EVERGATE_URL: mock.url,
    HERMES_TERMINAL_ID: "term-beat",
    EVERGATE_HEARTBEAT_MS: "120",
  });
  const count = () =>
    mock.presence.filter((p) => p.path === "register" && p.term === "term-beat")
      .length;
  try {
    // Initial register plus at least two heartbeats within a short window.
    await waitFor(() => count() >= 3, 2000);
    assert.ok(count() >= 3, `expected repeated heartbeats, got ${count()}`);
    assert.ok(mock.presence.length > before, "server saw the heartbeats");
  } finally {
    await client.close();
  }
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
  const env = { ...process.env, EVERGATE_URL: await unusedUrl() };
  // Same hermetic strip as connect(): don't let a wrapped dev session spawn a real delivery loop here.
  delete env.HERMES_INJECT_SOCK;
  delete env.HERMES_TERMINAL_ID;
  const transport = new StdioClientTransport({
    command: "node",
    args: [CONNECTOR],
    env,
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

test("polls its inbox and injects waiting messages into the launcher socket while idle", async () => {
  const sockPath = join(
    tmpdir(),
    "evergate",
    `inject-test-${process.pid}.sock`,
  );
  mkdirSync(dirname(sockPath), { recursive: true });
  rmSync(sockPath, { force: true });
  const received = [];
  const injectServer = createUnixServer((conn) => {
    let buf = "";
    conn.setEncoding("utf8");
    conn.on("data", (d) => (buf += d));
    conn.on("end", () => received.push(buf));
  });
  await new Promise((r) => injectServer.listen(sockPath, r));
  mock.pull.push({ from: "alice", message: "wake up", at: "just now" });

  const client = await connect({
    EVERGATE_URL: mock.url,
    HERMES_TERMINAL_ID: "term-idle",
    HERMES_INJECT_SOCK: sockPath,
    EVERGATE_POLL_MS: "80",
  });
  try {
    const got = await waitFor(
      () => received.find((r) => r.includes("wake up")),
      3000,
    );
    assert.ok(got, "the launcher socket received the injected message");
    assert.match(got, /alice.*wake up/);
    assert.ok(
      got.endsWith("\n"),
      "payload is newline-terminated for the launcher",
    );
  } finally {
    await client.close();
    injectServer.close();
    rmSync(sockPath, { force: true });
  }
});

test("does not poll for delivery when no launcher socket is present", async () => {
  mock.pull.push({ from: "alice", message: "should not be pulled", at: "now" });
  const client = await connect({
    EVERGATE_URL: mock.url,
    HERMES_TERMINAL_ID: "term-nosock",
    EVERGATE_POLL_MS: "80",
  });
  try {
    // Give it time to have polled had it been going to; the queued message must remain undrained.
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(
      mock.pull.length,
      1,
      "inbox was never polled without a socket",
    );
  } finally {
    mock.pull.splice(0);
    await client.close();
  }
});
