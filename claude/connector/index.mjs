#!/usr/bin/env node
// @ts-check
// Entrypoint: run the bridge and presence for the life of the process.
import { bridgeStdin } from "./bridge.mjs";
import { startPresence } from "./presence.mjs";
import { log } from "./log.mjs";

let closing = false;
/** @type {{ stop: () => Promise<void> } | null} */
let presence = null;

// Deregister and exit once, from whichever trigger fires first.
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await presence?.stop();
  process.exit(0);
};

const start = () => {
  bridgeStdin();
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  // Claude closes us by ending stdin.
  process.stdin.on("end", () => void shutdown());
  process.stdin.on("close", () => void shutdown());

  presence = startPresence();
  log.ready();
};

start();
