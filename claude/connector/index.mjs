#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ID = process.env.CLAUDE_CODE_SESSION_ID || randomUUID();
const BASE = (process.env.EVERGATE_URL || "http://localhost:8765").replace(/\/+$/, "");

const log = (msg) => process.stderr.write(`[evergate-connector] ${msg}\n`);

// Presence lifecycle: announce this session on start, remove it on exit. Both are best-effort
// and carry identity in the header, exactly like the bridged MCP requests.
const presence = (path) =>
  fetch(`${BASE}/hermes/${path}`, {
    method: "POST",
    headers: { "X-Hermes-Agent": ID },
    signal: AbortSignal.timeout(2000),
  }).then(
    (res) => { if (!res.ok) log(`${path} HTTP ${res.status}`); },
    (err) => log(`${path} ${err}`),
  );

const http = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
  requestInit: { headers: { "X-Hermes-Agent": ID } },
});
const stdio = new StdioServerTransport();

// Forward stdio->http; if a request (has id) fails to send, answer the caller so it doesn't hang.
stdio.onmessage = (msg) =>
  http.send(msg).catch((err) => {
    log(`->http ${err}`);
    if (msg.id != null)
      stdio
        .send({ jsonrpc: "2.0", id: msg.id, error: { code: -32001, message: `connector: ${err}` } })
        .catch((e) => log(`->stdio ${e}`));
  });
http.onmessage = (msg) => stdio.send(msg).catch((err) => log(`->stdio ${err}`));

// The stateless server has no SSE GET stream, so the client's attempt to open one 404s; and on
// shutdown its pending fetch aborts. Both are expected — keep them out of the log, surface the rest.
const isBenign = (err) =>
  err?.name === "AbortError" ||
  /Failed to open SSE stream|operation was aborted/i.test(String(err?.message ?? err));

http.onerror = (err) => { if (!isBenign(err)) log(`http ${err}`); };
stdio.onerror = (err) => log(`stdio ${err}`);

// Tear down both sides exactly once, from whichever closes first (or a signal): drop presence,
// close both transports, then exit. The guard makes the close() cascade a no-op re-entry.
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await presence("deregister");
  await http.close().catch((err) => log(`close http ${err}`));
  await stdio.close().catch((err) => log(`close stdio ${err}`));
  process.exit(0);
};
stdio.onclose = () => void shutdown();
http.onclose = () => void shutdown();
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
// Claude closes the connector by ending its stdin. StdioServerTransport ignores that EOF, and
// with nothing else holding the loop open the process would exit before we can deregister — so
// watch stdin directly. The pending deregister fetch keeps us alive until it lands.
process.stdin.on("end", () => void shutdown());
process.stdin.on("close", () => void shutdown());

await http.start();
await stdio.start();
void presence("register");
log(`bridging session ${ID} to ${BASE}`);
