import { beforeEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Hermes } from "../../src/services/hermes.js";
import { listSessionsOutputSchema } from "../../src/schemas/hermes.js";

const NOW = Date.parse("2026-07-05T12:00:00.000Z");
const MID = Date.parse("2026-07-05T12:15:00.000Z");
const LATER = Date.parse("2026-07-05T12:30:00.000Z");

let hermes: Hermes;

beforeEach(() => {
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
    expect(hermes.listSessions().sessions).toHaveLength(1);
  });

  it("returns undefined for a session that never registered", () => {
    expect(hermes.getSession("nobody")).toBeUndefined();
  });
});

describe("listSessions", () => {
  it("returns no sessions when the registry is empty", () => {
    expect(hermes.listSessions().sessions).toEqual([]);
  });

  it("orders by recency, not by session id", () => {
    // Recency and alphabetical disagree: session-z is seen first, session-a last.
    register("session-z", { description: "one" }, NOW);
    register("session-a", { description: "two" }, LATER);
    expect(
      hermes.listSessions(LATER).sessions.map((s) => s.session_id),
    ).toEqual(["session-a", "session-z"]);
  });

  it("moves a session to the front when it re-registers", () => {
    // b registered after a, so ordering by registered_at would give b, a;
    // only last_seen (bumped by a's re-register) yields a, b.
    register("session-a", { description: "one" }, NOW);
    register("session-b", { description: "two" }, MID);
    register("session-a", { description: "one again" }, LATER);
    expect(
      hermes.listSessions(LATER).sessions.map((s) => s.session_id),
    ).toEqual(["session-a", "session-b"]);
  });

  it("produces output conforming to the schema, without registered_at", () => {
    register("session-a", { description: "one" }, NOW);
    const result = hermes.listSessions(NOW);
    expect(z.object(listSessionsOutputSchema).safeParse(result).success).toBe(
      true,
    );
    expect(result.sessions[0]).not.toHaveProperty("registered_at");
  });

  it("surfaces the description and a relative last-seen", () => {
    register("session-a", { description: "building the api" }, NOW);
    expect(hermes.listSessions(NOW).sessions).toEqual([
      {
        session_id: "session-a",
        description: "building the api",
        last_seen: "just now",
      },
    ]);
  });

  it("maps each row independently across multiple sessions", () => {
    const twoHoursAgo = Date.parse("2026-07-05T10:00:00.000Z");
    const fiveMinAgo = Date.parse("2026-07-05T11:55:00.000Z");
    register("session-old", { description: "the old one" }, twoHoursAgo);
    register("session-new", { description: "the new one" }, fiveMinAgo);
    expect(hermes.listSessions(NOW).sessions).toEqual([
      {
        session_id: "session-new",
        description: "the new one",
        last_seen: "5 minutes ago",
      },
      {
        session_id: "session-old",
        description: "the old one",
        last_seen: "2 hours ago",
      },
    ]);
  });

  it("renders a nonzero elapsed interval as a relative time", () => {
    register("session-a", { description: "one" }, NOW);
    expect(hermes.listSessions(MID).sessions).toEqual([
      {
        session_id: "session-a",
        description: "one",
        last_seen: "15 minutes ago",
      },
    ]);
  });

  it("falls back to the raw ISO last_seen when a relative time can't be formed", () => {
    // last_seen is after `now`, so relativeTime returns null and the raw ISO is used.
    register("session-a", { description: "one" }, LATER);
    expect(hermes.listSessions(NOW).sessions).toEqual([
      {
        session_id: "session-a",
        description: "one",
        last_seen: new Date(LATER).toISOString(),
      },
    ]);
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

  it("throws when the first array value is blank, ignoring later values", () => {
    expect(() =>
      hermes.registerSession(
        input,
        { "x-hermes-agent": ["   ", "session-b"] },
        NOW,
      ),
    ).toThrow();
    expect(hermes.getSession("session-b")).toBeUndefined();
  });

  it("throws when the header array is empty", () => {
    expect(() =>
      hermes.registerSession(input, { "x-hermes-agent": [] }, NOW),
    ).toThrow();
  });
});

describe("create with a file path", () => {
  it("creates the parent directory and persists across reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-"));
    // A nested path whose parent does not exist yet, so mkdirSync must create it.
    const dbPath = join(dir, "nested", "hermes.db");
    try {
      const first = Hermes.create({ dbPath });
      first.registerSession(
        { description: "one" },
        { "x-hermes-agent": "session-a" },
        NOW,
      );
      first.close();

      const reopened = Hermes.create({ dbPath });
      expect(reopened.getSession("session-a")?.description).toBe("one");
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("close", () => {
  it("closes the database so further use throws", () => {
    register("session-a", { description: "one" }, NOW);
    hermes.close();
    expect(() => hermes.getSession("session-a")).toThrow();
  });
});
