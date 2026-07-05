import { describe, it, expect } from "vitest";
import { normalizeText, relativeTime } from "../../src/lib.js";

const NOW = Date.parse("2026-06-30T12:00:00.000Z");
const SEC = 1000;
const MIN = 60 * SEC;
const HR = 60 * MIN;
const DAY = 24 * HR;
const ago = (ms: number) => relativeTime(new Date(NOW - ms).toISOString(), NOW);

describe("relativeTime", () => {
  it.each<[number, string]>([
    [0, "just now"],
    [30 * SEC, "just now"],
    [44 * SEC, "just now"],
    [45 * SEC, "1 minute ago"], // upper edge of the "just now" band
    [60 * SEC, "1 minute ago"],
    [2 * MIN, "2 minutes ago"],
    [59 * MIN, "59 minutes ago"],
    [1 * HR, "1 hour ago"],
    [5 * HR, "5 hours ago"],
    [23 * HR, "23 hours ago"],
    [1 * DAY, "1 day ago"],
    [6 * DAY, "6 days ago"],
    [29 * DAY, "29 days ago"],
    [30 * DAY, "1 month ago"],
    [90 * DAY, "3 months ago"],
    [200 * DAY, "7 months ago"],
    [344 * DAY, "11 months ago"], // largest value that still reads as months
    [345 * DAY, "1 year ago"],
    [365 * DAY, "1 year ago"],
    [730 * DAY, "2 years ago"],
  ])("%i ms ago → %s", (ms, expected) => {
    expect(ago(ms)).toBe(expected);
  });

  it("treats any future timestamp as invalid", () => {
    expect(relativeTime(new Date(NOW + 2 * DAY).toISOString(), NOW)).toBeNull();
    // Even a sub-second future offset is null, not "just now".
    expect(relativeTime(new Date(NOW + 200).toISOString(), NOW)).toBeNull();
  });

  it.each<unknown>(["", "not-a-date", "2026-13-99", undefined, null])(
    "invalid input %o → null",
    (iso) => {
      expect(relativeTime(iso as string, NOW)).toBeNull();
    },
  );
});

describe("normalizeText", () => {
  it("leaves already-canonical text unchanged", () => {
    expect(normalizeText("database")).toBe("database");
  });

  it("trims surrounding whitespace and lowercases", () => {
    expect(normalizeText("  DataBase  ")).toBe("database");
  });

  it("yields null for blank or absent input", () => {
    expect(normalizeText("   ")).toBeNull();
    expect(normalizeText(undefined)).toBeNull();
  });
});
