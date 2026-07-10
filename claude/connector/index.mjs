#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ID = process.env.CLAUDE_CODE_SESSION_ID || randomUUID();
const BASE = (process.env.EVERGATE_URL || "http://localhost:8765").replace(/\/+$/, "");

const log = (msg) => process.stderr.write(`[evergate-connector] ${msg}\n`);

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

http.onerror = (err) => log(`http ${err}`);
stdio.onerror = (err) => log(`stdio ${err}`);

// Tear down both sides exactly once, from whichever closes first (no mutual recursion).
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  void http.close();
  void stdio.close();
};
stdio.onclose = shutdown;
http.onclose = shutdown;

await http.start();
await stdio.start();
log(`bridging session ${ID} to ${BASE}`);
