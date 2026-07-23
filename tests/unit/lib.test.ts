import { describe, it, expect } from "vitest";
import {
  normalizeText,
  parseTerminalId,
  relativeTime,
  requireTerminalId,
} from "@/lib";
import { MissingIdentityError } from "@/errors";

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

describe("requireTerminalId", () => {
  it("returns the X-Hermes-Terminal header value", () => {
    expect(requireTerminalId({ "x-hermes-terminal": "term-a" })).toBe("term-a");
  });

  it("trims surrounding whitespace", () => {
    expect(requireTerminalId({ "x-hermes-terminal": "  term-a  " })).toBe(
      "term-a",
    );
  });

  it("uses the first value when the header arrives as an array", () => {
    expect(
      requireTerminalId({ "x-hermes-terminal": ["term-a", "term-b"] }),
    ).toBe("term-a");
  });

  it("throws when the header is absent", () => {
    expect(() => requireTerminalId({})).toThrow(MissingIdentityError);
    expect(() => requireTerminalId(undefined)).toThrow(MissingIdentityError);
  });

  it("throws when the header is blank", () => {
    expect(() => requireTerminalId({ "x-hermes-terminal": "   " })).toThrow(
      MissingIdentityError,
    );
  });

  it("throws when the first array value is blank, ignoring later values", () => {
    expect(() =>
      requireTerminalId({ "x-hermes-terminal": ["   ", "term-b"] }),
    ).toThrow(MissingIdentityError);
  });

  it("throws when the header array is empty", () => {
    expect(() => requireTerminalId({ "x-hermes-terminal": [] })).toThrow(
      MissingIdentityError,
    );
  });
});

describe("parseTerminalId", () => {
  it("returns the trimmed terminal id when present", () => {
    expect(parseTerminalId({ "x-hermes-terminal": "  term-a  " })).toBe(
      "term-a",
    );
    expect(parseTerminalId({ "x-hermes-terminal": ["term-a"] })).toBe("term-a");
  });

  it("returns undefined when the header is absent, blank, or an empty array", () => {
    expect(parseTerminalId({})).toBeUndefined();
    expect(parseTerminalId(undefined)).toBeUndefined();
    expect(parseTerminalId({ "x-hermes-terminal": "   " })).toBeUndefined();
    expect(parseTerminalId({ "x-hermes-terminal": [] })).toBeUndefined();
  });
});
