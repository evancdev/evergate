// @ts-check
// Presence and idle delivery — wrapped sessions only.
import { createConnection } from "node:net";
import {
  BASE,
  HEARTBEAT_MS,
  INJECT_SOCK,
  POLL_MS,
  WRAPPED,
} from "./config.mjs";
import { identity } from "./identity.mjs";

/** @typedef {{ from: string, at: string, message: string }} InboxMessage */

let stopped = false;
/** @type {ReturnType<typeof setInterval> | null} */
let beat = null;
/** @type {ReturnType<typeof setInterval> | null} */
let poll = null;

// Announce/remove this session; best-effort, identity in the header like the bridged requests.
/** @param {string} path */
const presence = (path) =>
  fetch(`${BASE}/hermes/${path}`, {
    method: "POST",
    headers: identity(),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});

// Type text into our own Claude session through the wrapper's inject socket; best-effort.
/** @param {string} text */
const injectToLauncher = (text) =>
  new Promise((resolve) => {
    if (!INJECT_SOCK) return resolve(undefined);
    const conn = createConnection(INJECT_SOCK, () => {
      conn.end(text.replace(/[\r\n]+/g, " ").trim() + "\n");
    });
    conn.on("error", () => resolve(undefined));
    conn.on("close", () => resolve(undefined));
  });

// Drain our inbox and inject waiting messages while idle; the server returns none mid-turn, so the Stop hook covers that.
const pollAndDeliver = async () => {
  if (stopped) return;
  let messages;
  try {
    const res = await fetch(`${BASE}/hermes/pull`, {
      method: "POST",
      headers: identity(),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return;
    const body = /** @type {{ messages?: InboxMessage[] }} */ (
      await res.json()
    );
    messages = body.messages;
  } catch {
    return;
  }
  if (!messages || messages.length === 0) return;
  const summary = messages
    .map((m) => `${m.from} (${m.at}): ${m.message}`)
    .join("  |  ");
  await injectToLauncher(
    `[Hermes] New message(s) from other sessions — ${summary}. Respond or act on them.`,
  );
};

// Register + heartbeat + idle poll under the wrapper; returns stop() for shutdown. No-op unwrapped.
export const startPresence = () => {
  if (!WRAPPED) return { stop: async () => {} };
  void presence("register");
  // Heartbeat: re-register to stay fresh; a hard crash ages out server-side. unref.
  beat = setInterval(() => void presence("register"), HEARTBEAT_MS).unref();
  // Idle-delivery poller: only under the PTY wrapper; drains the current session's inbox. unref.
  poll = INJECT_SOCK
    ? setInterval(() => void pollAndDeliver(), POLL_MS).unref()
    : null;
  return {
    stop: async () => {
      stopped = true;
      clearInterval(beat ?? undefined);
      clearInterval(poll ?? undefined);
      await presence("deregister");
    },
  };
};
