#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ID = process.env.CLAUDE_CODE_SESSION_ID || randomUUID();
const BASE = (process.env.EVERGATE_URL || "http://localhost:8765").replace(/\/+$/, "");
const HEARTBEAT_MS = Number(process.env.EVERGATE_HEARTBEAT_MS) || 60_000;

const log = (msg) => process.stderr.write(`[evergate-connector] ${msg}\n`);

// Announce/remove this session; best-effort, identity in the header like the bridged requests.
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

// Forward stdio→http; if a request can't be sent, answer it so the caller doesn't hang.
stdio.onmessage = (msg) =>
  http.send(msg).catch((err) => {
    log(`->http ${err}`);
    if (msg.id != null)
      stdio
        .send({ jsonrpc: "2.0", id: msg.id, error: { code: -32001, message: `connector: ${err}` } })
        .catch((e) => log(`->stdio ${e}`));
  });
http.onmessage = (msg) => stdio.send(msg).catch((err) => log(`->stdio ${err}`));

// Expected noise: the stateless server 404s the SSE stream, and its fetch aborts on shutdown.
const isBenign = (err) =>
  err?.name === "AbortError" ||
  /Failed to open SSE stream|operation was aborted/i.test(String(err?.message ?? err));

http.onerror = (err) => { if (!isBenign(err)) log(`http ${err}`); };
stdio.onerror = (err) => log(`stdio ${err}`);

// Drop presence, close both sides, exit — once, from whichever trigger fires first.
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  clearInterval(beat);
  await presence("deregister");
  await http.close().catch((err) => log(`close http ${err}`));
  await stdio.close().catch((err) => log(`close stdio ${err}`));
  process.exit(0);
};
stdio.onclose = () => void shutdown();
http.onclose = () => void shutdown();
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
// Claude closes us by ending stdin; the SDK transport ignores that EOF, so watch it directly.
process.stdin.on("end", () => void shutdown());
process.stdin.on("close", () => void shutdown());

await http.start();
await stdio.start();
void presence("register");
// Heartbeat so a hard crash (kill -9) that skips deregister ages out server-side. unref so it
// never holds the process open on its own.
const beat = setInterval(() => void presence("register"), HEARTBEAT_MS).unref();
log(`bridging session ${ID} to ${BASE}`);
