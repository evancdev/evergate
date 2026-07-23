// @ts-check
// Bridge: newline-delimited JSON-RPC on stdio to the evergate server over HTTP.
import { BASE } from "./config.mjs";
import { identity } from "./identity.mjs";
import { log, toClient } from "./log.mjs";

/** @typedef {{ id?: string | number | null, [key: string]: unknown }} RpcMessage */

// Answer a request with an error so Claude doesn't hang when the server can't reply.
/**
 * @param {RpcMessage} msg
 * @param {unknown} err
 */
const fail = (msg, err) => {
  log.httpFail(err);
  if (msg?.id != null)
    toClient({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32001, message: `connector: ${String(err)}` },
    });
};

// Bridge one message from Claude to the server; forward any replies back, stamping our identity.
/** @param {RpcMessage} msg */
async function relay(msg) {
  let res;
  try {
    // No timeout on purpose: tool calls can run long and a cap here would kill slow ones.
    res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The server requires we accept event-stream even though it replies with plain JSON.
        Accept: "application/json, text/event-stream",
        ...identity(),
      },
      body: JSON.stringify(msg),
    });
  } catch (err) {
    return fail(msg, err);
  }
  if (res.status === 202 || res.status === 204) return; // notification/response accepted, no reply
  if (!res.ok) return fail(msg, `HTTP ${res.status}`);
  try {
    const body = await res.json();
    for (const m of Array.isArray(body) ? body : [body]) toClient(m);
  } catch (err) {
    fail(msg, err);
  }
}

// Read newline-delimited JSON-RPC from Claude and relay each message; this also holds the process open.
export const bridgeStdin = () => {
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
      } catch {
        continue;
      }
      void relay(msg);
    }
  });
};
