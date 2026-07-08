import { beforeEach, describe, it, expect } from "vitest";
import { Hermes } from "../../src/services/hermes.js";

const NOW = Date.parse("2026-07-05T12:00:00.000Z");
const LATER = Date.parse("2026-07-05T12:30:00.000Z");

let hermes: Hermes;

beforeEach(() => {
  // A fresh in-memory database per test — no Docker, no shared state.
  hermes = Hermes.create({ dbPath: ":memory:" });
});

/** Register the given session (identified by its X-Hermes-Agent header) at `at`. */
function register(
  sessionId: string,
  input: Parameters<Hermes["registerSession"]>[0],
  at: number = NOW,
): void {
  hermes.registerSession(input, { "x-hermes-agent": sessionId }, at);
}

describe("registerSession", () => {
  it("records a session keyed by its own session id", () => {
    register("session-a", { description: "building the api" }, NOW);
    const row = hermes.getSession("session-a");
    expect(row).toEqual({
      session_id: "session-a",
      description: "building the api",
      registered_at: new Date(NOW).toISOString(),
      last_seen: new Date(NOW).toISOString(),
    });
  });

  it("keeps distinct sessions distinct", () => {
    register("session-a", { description: "one" });
    register("session-b", { description: "two" });
    expect(hermes.getSession("session-a")?.description).toBe("one");
    expect(hermes.getSession("session-b")?.description).toBe("two");
  });

  it("re-register updates the description and bumps last_seen without duplicating or moving registered_at", () => {
    register("session-a", { description: "v1" }, NOW);
    register("session-a", { description: "v2" }, LATER);
    const row = hermes.getSession("session-a");
    expect(row).toEqual({
      session_id: "session-a",
      description: "v2",
      registered_at: new Date(NOW).toISOString(),
      last_seen: new Date(LATER).toISOString(),
    });
  });

  it("returns undefined for a session that never registered", () => {
    expect(hermes.getSession("nobody")).toBeUndefined();
  });
});

describe("registerSession identity", () => {
  const input = { description: "x" };

  it("throws when the X-Hermes-Agent header is missing", () => {
    expect(() => hermes.registerSession(input, {}, NOW)).toThrow(
      /X-Hermes-Agent/,
    );
    expect(() => hermes.registerSession(input, undefined, NOW)).toThrow(
      /X-Hermes-Agent/,
    );
  });

  it("throws when the header is blank", () => {
    expect(() =>
      hermes.registerSession(input, { "x-hermes-agent": "   " }, NOW),
    ).toThrow();
  });

  it("trims the header value and keys the session on the trimmed id", () => {
    hermes.registerSession(input, { "x-hermes-agent": "  session-a  " }, NOW);
    expect(hermes.getSession("session-a")?.description).toBe("x");
  });

  it("uses the first value when the header arrives as an array", () => {
    hermes.registerSession(
      input,
      { "x-hermes-agent": ["session-a", "session-b"] },
      NOW,
    );
    expect(hermes.getSession("session-a")?.description).toBe("x");
    expect(hermes.getSession("session-b")).toBeUndefined();
  });
});
