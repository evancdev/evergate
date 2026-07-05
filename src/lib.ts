/** Trim and lowercase text; blank or absent yields null. */
export function normalizeText(text: string | undefined): string | null {
  return (text ?? "").trim().toLowerCase() || null;
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
