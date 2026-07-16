import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Hermes } from "@/services/hermes";
import { MissingIdentityError } from "@/errors";
import { listSessionsOutputSchema } from "@/schemas/hermes";
import { logger } from "@/logger";

const NOW = Date.parse("2026-07-05T12:00:00.000Z");
const MID = Date.parse("2026-07-05T12:15:00.000Z");
const LATER = Date.parse("2026-07-05T12:30:00.000Z");

let hermes: Hermes;

beforeEach(() => {
  hermes = Hermes.create({ dbPath: ":memory:" });
});

// close() stops the sweeper's interval; idempotent, so tests that close early are fine.
afterEach(() => hermes.close());

/** Set the given session's description (identified by its X-Hermes-Agent header) at `at`. */
function register(
  sessionId: string,
  input: Parameters<Hermes["setDescription"]>[0],
  at: number = NOW,
): void {
  hermes.setDescription(input, { "x-hermes-agent": sessionId }, at);
}

describe("setDescription", () => {
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
    expect(hermes.listSessions(LATER).sessions).toHaveLength(1);
  });

  it("returns undefined for a session that never registered", () => {
    expect(hermes.getSession("nobody")).toBeUndefined();
  });
});

describe("register (signup)", () => {
  it("signs a session in with a placeholder description", () => {
    hermes.register({ "x-hermes-agent": "session-a" }, NOW);
    expect(hermes.getSession("session-a")).toEqual({
      session_id: "session-a",
      description: "(no description yet)",
      registered_at: new Date(NOW).toISOString(),
      last_seen: new Date(NOW).toISOString(),
    });
  });

  it("re-register keeps an existing description and only bumps last_seen", () => {
    hermes.register({ "x-hermes-agent": "session-a" }, NOW);
    hermes.setDescription(
      { description: "real work" },
      { "x-hermes-agent": "session-a" },
      MID,
    );
    hermes.register({ "x-hermes-agent": "session-a" }, LATER);
    expect(hermes.getSession("session-a")).toEqual({
      session_id: "session-a",
      description: "real work",
      registered_at: new Date(NOW).toISOString(),
      last_seen: new Date(LATER).toISOString(),
    });
  });

  it("throws when the X-Hermes-Agent header is absent", () => {
    expect(() => hermes.register({})).toThrow(MissingIdentityError);
  });
});

describe("listSessions", () => {
  it("returns no sessions when the registry is empty", () => {
    expect(hermes.listSessions().sessions).toEqual([]);
  });

  it("orders by recency, not by session id", () => {
    // Recency and alphabetical disagree: session-z is seen first, session-a last.
    register("session-z", { description: "one" }, NOW);
    register("session-a", { description: "two" }, NOW + 60_000);
    expect(
      hermes.listSessions(NOW + 60_000).sessions.map((s) => s.session_id),
    ).toEqual(["session-a", "session-z"]);
  });

  it("moves a session to the front when it re-registers", () => {
    // b registered after a, so ordering by registered_at would give b, a;
    // only last_seen (bumped by a's re-register) yields a, b.
    register("session-a", { description: "one" }, NOW);
    register("session-b", { description: "two" }, NOW + 60_000);
    register("session-a", { description: "one again" }, NOW + 120_000);
    expect(
      hermes.listSessions(NOW + 120_000).sessions.map((s) => s.session_id),
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
    const threeMinAgo = NOW - 3 * 60_000;
    register("session-newer", { description: "the newer one" }, NOW);
    register("session-older", { description: "the older one" }, threeMinAgo);
    expect(hermes.listSessions(NOW).sessions).toEqual([
      {
        session_id: "session-newer",
        description: "the newer one",
        last_seen: "just now",
      },
      {
        session_id: "session-older",
        description: "the older one",
        last_seen: "3 minutes ago",
      },
    ]);
  });

  it("renders a nonzero elapsed interval as a relative time", () => {
    register("session-a", { description: "one" }, NOW);
    expect(hermes.listSessions(NOW + 4 * 60_000).sessions).toEqual([
      {
        session_id: "session-a",
        description: "one",
        last_seen: "4 minutes ago",
      },
    ]);
  });

  it("hides a session once it is past the staleness cutoff, without deleting it", () => {
    register("ghost", { description: "gone" }, NOW);
    // No new registration and no sweeper — just read 10 min later. The read filters it out,
    // even though the row is still physically in the table.
    expect(hermes.listSessions(NOW + 10 * 60_000).sessions).toEqual([]);
    expect(hermes.getSession("ghost")).toBeDefined();
  });

  it("still shows a session seen within the cutoff", () => {
    register("live", { description: "here" }, NOW);
    expect(
      hermes.listSessions(NOW + 2 * 60_000).sessions.map((s) => s.session_id),
    ).toEqual(["live"]);
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

describe("deregister", () => {
  it("removes exactly that session and leaves the others", () => {
    register("session-a", { description: "one" });
    register("session-b", { description: "two" });
    hermes.deregister({ "x-hermes-agent": "session-a" });
    expect(hermes.getSession("session-a")).toBeUndefined();
    expect(hermes.getSession("session-b")?.description).toBe("two");
  });

  it("drops the session from the directory listing", () => {
    register("session-a", { description: "one" });
    register("session-b", { description: "two" });
    hermes.deregister({ "x-hermes-agent": "session-a" });
    expect(hermes.listSessions(NOW).sessions.map((s) => s.session_id)).toEqual([
      "session-b",
    ]);
  });

  it("is a no-op for an unknown id, disturbing nothing", () => {
    register("session-a", { description: "one" });
    expect(() =>
      hermes.deregister({ "x-hermes-agent": "nobody" }),
    ).not.toThrow();
    expect(hermes.getSession("session-a")?.description).toBe("one");
    expect(hermes.listSessions(NOW).sessions).toHaveLength(1);
  });

  it("throws when the X-Hermes-Agent header is absent", () => {
    expect(() => hermes.deregister({})).toThrow(MissingIdentityError);
  });

  it("lets a deregistered id register again as a fresh session", () => {
    register("session-a", { description: "one" }, NOW);
    hermes.deregister({ "x-hermes-agent": "session-a" });
    register("session-a", { description: "back again" }, LATER);
    expect(hermes.getSession("session-a")).toEqual({
      session_id: "session-a",
      description: "back again",
      registered_at: new Date(LATER).toISOString(),
      last_seen: new Date(LATER).toISOString(),
    });
  });
});

describe("setDescription identity", () => {
  const input = { description: "x" };

  it("throws when the X-Hermes-Agent header is missing", () => {
    expect(() => hermes.setDescription(input, {}, NOW)).toThrow(
      /X-Hermes-Agent/,
    );
    expect(() => hermes.setDescription(input, undefined, NOW)).toThrow(
      /X-Hermes-Agent/,
    );
  });

  it("throws when the header is blank", () => {
    expect(() =>
      hermes.setDescription(input, { "x-hermes-agent": "   " }, NOW),
    ).toThrow();
  });

  it("trims the header value and keys the session on the trimmed id", () => {
    hermes.setDescription(input, { "x-hermes-agent": "  session-a  " }, NOW);
    expect(hermes.getSession("session-a")?.description).toBe("x");
  });

  it("uses the first value when the header arrives as an array", () => {
    hermes.setDescription(
      input,
      { "x-hermes-agent": ["session-a", "session-b"] },
      NOW,
    );
    expect(hermes.getSession("session-a")?.description).toBe("x");
    expect(hermes.getSession("session-b")).toBeUndefined();
  });

  it("throws when the first array value is blank, ignoring later values", () => {
    expect(() =>
      hermes.setDescription(
        input,
        { "x-hermes-agent": ["   ", "session-b"] },
        NOW,
      ),
    ).toThrow();
    expect(hermes.getSession("session-b")).toBeUndefined();
  });

  it("throws when the header array is empty", () => {
    expect(() =>
      hermes.setDescription(input, { "x-hermes-agent": [] }, NOW),
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
      first.setDescription(
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

describe("sweeper (server-owned expiry)", () => {
  it("sweeps a dead session on its own timer, with no new registration", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      const h = Hermes.create({ dbPath: ":memory:" });
      h.register({ "x-hermes-agent": "ghost" }, NOW);
      expect(h.getSession("ghost")).toBeDefined();
      // Jump past the cutoff; the sweeper fires by itself — nobody registers.
      vi.setSystemTime(NOW + 10 * 60_000);
      vi.advanceTimersByTime(60_000);
      expect(h.getSession("ghost")).toBeUndefined();
      h.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a session still within the cutoff alone", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      const h = Hermes.create({ dbPath: ":memory:" });
      h.register({ "x-hermes-agent": "fresh" }, NOW);
      // 2 min later — still within the 5-min cutoff, so the sweeper spares it.
      vi.setSystemTime(NOW + 2 * 60_000);
      vi.advanceTimersByTime(60_000);
      expect(h.getSession("fresh")).toBeDefined();
      h.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops sweeping once closed", () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      vi.setSystemTime(NOW);
      const h = Hermes.create({ dbPath: ":memory:" });
      h.close();
      vi.advanceTimersByTime(60_000);
      // A live interval would fire on the closed db and log; a cleared one never fires.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("swallows and logs a failing sweep instead of crashing", () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      const h = Hermes.create({ dbPath: ":memory:" });
      // Close the db out from under the sweeper so its next sweep errors on a dead handle.
      (h as unknown as { db: { close(): void } }).db.close();
      expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
