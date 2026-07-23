// @ts-check
// Connector output: stderr logs and stdout replies to Claude.
import { BASE, WRAPPED } from "./config.mjs";

/** @param {string} msg */
const write = (msg) => process.stderr.write(`[evergate-connector] ${msg}\n`);

export const log = {
  /** @param {unknown} err */
  httpFail: (err) => write(`->http ${String(err)}`),
  ready: () =>
    write(`bridging to ${BASE}${WRAPPED ? " (wrapped)" : " (tools only)"}`),
};

// Write one JSON-RPC message per line to Claude's stdout — MCP stdio framing.
/** @param {unknown} msg */
export const toClient = (msg) =>
  process.stdout.write(JSON.stringify(msg) + "\n");
