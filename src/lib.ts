import type { IsomorphicHeaders } from "@modelcontextprotocol/sdk/types.js";
import { MissingIdentityError } from "@/errors";

/** Trim and lowercase text; blank or absent yields null. */
export function normalizeText(text: string | undefined): string | null {
  return (text ?? "").trim().toLowerCase() || null;
}

/** The caller's terminal id from X-Hermes-Terminal, trimmed, or undefined if absent or blank. */
export function parseTerminalId(
  headers: IsomorphicHeaders | undefined,
): string | undefined {
  const raw = headers?.["x-hermes-terminal"];
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined;
}

/** The caller's terminal id from X-Hermes-Terminal. Throws if absent or blank. */
export function requireTerminalId(
  headers: IsomorphicHeaders | undefined,
): string {
  const value = parseTerminalId(headers);
  if (!value)
    throw new MissingIdentityError("Missing X-Hermes-Terminal header");
  return value;
}

/** Format an ISO timestamp as a relative note of how long ago it was; null if missing, malformed, or in the future. */
export function relativeTime(
  iso: string,
  now: number = Date.now(),
): string | null {
  const then = new Date(iso).getTime();
  if (!iso || Number.isNaN(then) || then > now) return null;

  const sec = Math.round((now - then) / 1000);

  const formatAgo = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return formatAgo(min, "minute");
  const hr = Math.round(min / 60);
  if (hr < 24) return formatAgo(hr, "hour");
  const day = Math.round(hr / 24);
  if (day < 30) return formatAgo(day, "day");
  const mon = Math.round(day / 30);
  if (mon < 12) return formatAgo(mon, "month");
  return formatAgo(Math.round(day / 365), "year");
}
