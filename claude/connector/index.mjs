#!/usr/bin/env node
import { randomUUID } from "node:crypto";

const ID = process.env.CLAUDE_CODE_SESSION_ID || randomUUID();
const BASE = (process.env.EVERGATE_URL || "http://localhost:8765").replace(
  /\/+$/,
  "",
);
const HEARTBEAT_MS = Number(process.env.EVERGATE_HEARTBEAT_MS) || 60_000;

const log = (msg) => process.stderr.write(`[evergate-connector] ${msg}\n`);

// Write one JSON-RPC message per line back to Claude (MCP stdio framing).
const toClient = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

// Answer a request with an error so Claude doesn't hang when the server can't reply.
const fail = (msg, err) => {
  log(`->http ${err}`);
  if (msg?.id != null)
    toClient({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32001, message: `connector: ${err}` },
    });
};

// Yield each JSON-RPC message from an SSE response body (data: {...} lines, blank line ends an event).
async function* readSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let data = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line === "") {
        if (data) yield JSON.parse(data);
        data = "";
      } else if (line.startsWith("data:")) {
        data += (data ? "\n" : "") + line.slice(5).replace(/^ /, "");
      }
    }
  }
  if (data) yield JSON.parse(data);
}

// Bridge one message from Claude to the server; forward any replies back, stamping our identity.
async function forward(msg) {
  let res;
  try {
    res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-Hermes-Agent": ID,
      },
      body: JSON.stringify(msg),
    });
  } catch (err) {
    return fail(msg, err);
  }
  if (res.status === 202 || res.status === 204) return; // notification/response accepted, no reply
  if (!res.ok) return fail(msg, `HTTP ${res.status}`);
  try {
    if ((res.headers.get("content-type") || "").includes("text/event-stream"))
      for await (const m of readSse(res.body)) toClient(m);
    else {
      const body = await res.json();
      for (const m of Array.isArray(body) ? body : [body]) toClient(m);
    }
  } catch (err) {
    fail(msg, err);
  }
}

// Read newline-delimited JSON-RPC from Claude and forward each message; this also holds the process open.
let inbuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inbuf += chunk;
  let nl;
  while ((nl = inbuf.indexOf("\n")) !== -1) {
    const line = inbuf.slice(0, nl).trim();
    inbuf = inbuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      log(`bad json ${err}`);
      continue;
    }
    void forward(msg);
  }
});

// Announce/remove this session; best-effort, identity in the header like the bridged requests.
const presence = (path) =>
  fetch(`${BASE}/hermes/${path}`, {
    method: "POST",
    headers: { "X-Hermes-Agent": ID },
    signal: AbortSignal.timeout(2000),
  }).then(
    (res) => {
      if (!res.ok) log(`${path} HTTP ${res.status}`);
    },
    (err) => log(`${path} ${err}`),
  );

// Deregister and exit once, from whichever trigger fires first.
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  clearInterval(beat);
  await presence("deregister");
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
// Claude closes us by ending stdin.
process.stdin.on("end", () => void shutdown());
process.stdin.on("close", () => void shutdown());

void presence("register");
// Heartbeat so a hard crash (kill -9) that skips deregister ages out server-side; unref so it never holds us open.
const beat = setInterval(() => void presence("register"), HEARTBEAT_MS).unref();
log(`bridging session ${ID} to ${BASE}`);
