// @ts-check
// Connector config, read from the environment.
export const TERMINAL_ID = process.env.HERMES_TERMINAL_ID;
export const WRAPPED = Boolean(TERMINAL_ID);
export const BASE = process.env.EVERGATE_URL || "http://localhost:8765";
export const HEARTBEAT_MS = Number(process.env.EVERGATE_HEARTBEAT_MS) || 60_000;
export const POLL_MS = Number(process.env.EVERGATE_POLL_MS) || 3_000;
export const INJECT_SOCK = process.env.HERMES_INJECT_SOCK;
