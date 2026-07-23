// @ts-check
// Identity stamped on server calls — only when wrapped.
import { TERMINAL_ID } from "./config.mjs";

export const identity = () =>
  TERMINAL_ID ? { "X-Hermes-Terminal": TERMINAL_ID } : {};
