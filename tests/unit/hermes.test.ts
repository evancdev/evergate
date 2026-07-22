import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Hermes } from "@/services/hermes";
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

/** Set the given session's description at `at`. */
function register(
  sessionId: string,
  input: Parameters<Hermes["setDescription"]>[0],
  at: number = NOW,
): void {
  hermes.setDescription(input, sessionId, at);
}

describe("setDescription", () => {
  it("records a session keyed by its own session id", () => {
    register("session-a", { description: "building the api" }, NOW);
    const row = hermes.getSession("session-a");
    expect(row).toEqual({
      terminal_id: "session-a",
      session_id: "session-a",
      description: "building the api",
      registered_at: new Date(NOW).toISOString(),
      last_seen: new Date(NOW).toISOString(),
      status: "idle",
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
      terminal_id: "session-a",
      session_id: "session-a",
      description: "v2",
      registered_at: new Date(NOW).toISOString(),
      last_seen: new Date(LATER).toISOString(),
      status: "idle",
    });
    expect(hermes.listSessions(LATER).sessions).toHaveLength(1);
  });

  it("returns undefined for a session that never registered", () => {
    expect(hermes.getSession("nobody")).toBeUndefined();
  });
});

describe("register (signup)", () => {
  it("signs a session in with a placeholder description", () => {
    hermes.register("session-a", NOW);
    expect(hermes.getSession("session-a")).toEqual({
      terminal_id: "session-a",
      session_id: "session-a",
      description: "(no description yet)",
      registered_at: new Date(NOW).toISOString(),
      last_seen: new Date(NOW).toISOString(),
      status: "idle",
    });
  });

  it("re-register keeps an existing description and only bumps last_seen", () => {
    hermes.register("session-a", NOW);
    hermes.setDescription({ description: "real work" }, "session-a", MID);
    hermes.register("session-a", LATER);
    expect(hermes.getSession("session-a")).toEqual({
      terminal_id: "session-a",
      session_id: "session-a",
      description: "real work",
      registered_at: new Date(NOW).toISOString(),
      last_seen: new Date(LATER).toISOString(),
      status: "idle",
    });
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
    // The tool adds `messages`; here we check the sessions half conforms.
    expect(
      z.object(listSessionsOutputSchema).safeParse({ ...result, messages: [] })
        .success,
    ).toBe(true);
    expect(result.sessions[0]).not.toHaveProperty("registered_at");
  });

  it("surfaces the description and a relative last-seen", () => {
    register("session-a", { description: "building the api" }, NOW);
    expect(hermes.listSessions(NOW).sessions).toEqual([
      {
        session_id: "session-a",
        description: "building the api",
        last_seen: "just now",
        status: "idle",
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
        status: "idle",
      },
      {
        session_id: "session-older",
        description: "the older one",
        last_seen: "3 minutes ago",
        status: "idle",
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
        status: "idle",
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
        status: "idle",
      },
    ]);
  });

  it("surfaces a busy status, not just idle", () => {
    hermes.register("session-a", NOW);
    hermes.setStatus({ status: "busy" }, "session-a", NOW);
    expect(hermes.listSessions(NOW).sessions[0]?.status).toBe("busy");
  });
});

describe("status", () => {
  it("defaults to idle and surfaces in listSessions", () => {
    hermes.register("session-a", NOW);
    expect(hermes.listSessions(NOW).sessions[0]?.status).toBe("idle");
  });

  it("flips to busy and back to idle, bumping last_seen", () => {
    hermes.register("session-a", NOW);
    hermes.setStatus({ status: "busy" }, "session-a", MID);
    expect(hermes.getSession("session-a")?.status).toBe("busy");
    expect(hermes.getSession("session-a")?.last_seen).toBe(
      new Date(MID).toISOString(),
    );
    hermes.setStatus({ status: "idle" }, "session-a", LATER);
    expect(hermes.getSession("session-a")?.status).toBe("idle");
  });

  it("upserts a session that sets status before registering", () => {
    hermes.setStatus({ status: "busy" }, "session-a", NOW);
    expect(hermes.getSession("session-a")).toEqual({
      terminal_id: "session-a",
      session_id: "session-a",
      description: "(no description yet)",
      registered_at: new Date(NOW).toISOString(),
      last_seen: new Date(NOW).toISOString(),
      status: "busy",
    });
  });

  it("preserves an existing session's description when flipping status", () => {
    register("session-a", { description: "real work" }, NOW);
    hermes.setStatus({ status: "busy" }, "session-a", MID);
    const row = hermes.getSession("session-a");
    expect(row?.description).toBe("real work");
    expect(row?.status).toBe("busy");
    expect(row?.registered_at).toBe(new Date(NOW).toISOString());
  });
});

describe("deregister", () => {
  it("removes exactly that session and leaves the others", () => {
    register("session-a", { description: "one" });
    register("session-b", { description: "two" });
    hermes.deregister("session-a");
    expect(hermes.getSession("session-a")).toBeUndefined();
    expect(hermes.getSession("session-b")?.description).toBe("two");
  });

  it("drops the session from the directory listing", () => {
    register("session-a", { description: "one" });
    register("session-b", { description: "two" });
    hermes.deregister("session-a");
    expect(hermes.listSessions(NOW).sessions.map((s) => s.session_id)).toEqual([
      "session-b",
    ]);
  });

  it("is a no-op for an unknown id, disturbing nothing", () => {
    register("session-a", { description: "one" });
    expect(() => hermes.deregister("nobody")).not.toThrow();
    expect(hermes.getSession("session-a")?.description).toBe("one");
    expect(hermes.listSessions(NOW).sessions).toHaveLength(1);
  });

  it("lets a deregistered id register again as a fresh session", () => {
    register("session-a", { description: "one" }, NOW);
    hermes.deregister("session-a");
    register("session-a", { description: "back again" }, LATER);
    expect(hermes.getSession("session-a")).toEqual({
      terminal_id: "session-a",
      session_id: "session-a",
      description: "back again",
      registered_at: new Date(LATER).toISOString(),
      last_seen: new Date(LATER).toISOString(),
      status: "idle",
    });
  });
});

describe("create with a file path", () => {
  it("creates the parent directory and persists across reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-"));
    // A nested path whose parent does not exist yet, so mkdirSync must create it.
    const dbPath = join(dir, "nested", "hermes.db");
    try {
      const first = Hermes.create({ dbPath });
      first.setDescription({ description: "one" }, "session-a", NOW);
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

describe("terminals (terminal -> live session)", () => {
  it("setSession points a terminal at a session; a new session flips it in place", () => {
    hermes.setSession("terminal-1", "sess-a", NOW);
    expect(hermes.getSession("sess-a")?.terminal_id).toBe("terminal-1");
    // Same terminal, new session id — the old row is overwritten, not aged out.
    hermes.setSession("terminal-1", "sess-b", LATER);
    expect(hermes.getSession("sess-b")?.terminal_id).toBe("terminal-1");
    expect(hermes.getSession("sess-a")).toBeUndefined();
    expect(hermes.listSessions(LATER).sessions).toHaveLength(1);
  });

  it("resets the description when the terminal's session changes, keeps it when unchanged", () => {
    hermes.setSession("terminal-1", "sess-a", NOW);
    hermes.setDescription(
      { description: "building the api" },
      "terminal-1",
      NOW,
    );
    // Set the SAME session id again: description survives.
    hermes.setSession("terminal-1", "sess-a", MID);
    expect(hermes.getSession("sess-a")?.description).toBe("building the api");
    // Set a NEW session id: description resets to the placeholder.
    hermes.setSession("terminal-1", "sess-b", LATER);
    expect(hermes.getSession("sess-b")?.description).toBe(
      "(no description yet)",
    );
  });

  it("resolveSession follows a terminal to its live session", () => {
    hermes.setSession("terminal-1", "sess-live", NOW);
    expect(hermes.resolveSession("terminal-1")).toBe("sess-live");
  });

  it("resolveSession falls back to the terminal id when it isn't in the roster yet", () => {
    expect(hermes.resolveSession("unmapped")).toBe("unmapped");
  });

  it("register never rewrites a terminal's session (the frozen connector can't reset it)", () => {
    // Terminal bound to the live session; the connector then re-registers on the same terminal.
    hermes.setSession("terminal-1", "sess-live", NOW);
    hermes.register("terminal-1", LATER);
    expect(hermes.getSession("sess-live")?.terminal_id).toBe("terminal-1");
  });

  it("register seeds session_id from the terminal id until setSession sets the real one", () => {
    hermes.register("terminal-1", NOW);
    expect(hermes.getSession("terminal-1")?.session_id).toBe("terminal-1");
  });

  it("resets status and registered_at on a session change, keeps them when unchanged", () => {
    hermes.setSession("terminal-1", "sess-a", NOW);
    hermes.setStatus({ status: "busy" }, "terminal-1", NOW);
    // Same session id: status and registered_at survive.
    hermes.setSession("terminal-1", "sess-a", MID);
    expect(hermes.getSession("sess-a")?.status).toBe("busy");
    expect(hermes.getSession("sess-a")?.registered_at).toBe(
      new Date(NOW).toISOString(),
    );
    // New session id: status resets to idle, registered_at bumps.
    hermes.setSession("terminal-1", "sess-b", LATER);
    expect(hermes.getSession("sess-b")?.status).toBe("idle");
    expect(hermes.getSession("sess-b")?.registered_at).toBe(
      new Date(LATER).toISOString(),
    );
  });

  it("deregister clears the inbox of the terminal's resolved session, not the terminal id", () => {
    hermes.setSession("terminal-1", "sess-real", NOW);
    hermes.sendMessage({ to: "sess-real", message: "hi" }, "sender", NOW);
    expect(hermes.peekMessages("sess-real", NOW).messages).toHaveLength(1);
    hermes.deregister("terminal-1");
    expect(hermes.peekMessages("sess-real", NOW).messages).toHaveLength(0);
  });

  it("setSession drops the old session's inbox when the session changes", () => {
    hermes.setSession("terminal-1", "sess-a", NOW);
    hermes.sendMessage({ to: "sess-a", message: "stale" }, "sender", NOW);
    hermes.setSession("terminal-1", "sess-b", LATER);
    expect(hermes.peekMessages("sess-a", LATER).messages).toHaveLength(0);
  });

  it("setSession keeps the inbox when the same session id is set again", () => {
    hermes.setSession("terminal-1", "sess-a", NOW);
    hermes.sendMessage({ to: "sess-a", message: "still here" }, "sender", NOW);
    hermes.setSession("terminal-1", "sess-a", LATER);
    expect(hermes.peekMessages("sess-a", LATER).messages).toHaveLength(1);
  });
});

describe("sweeper (server-owned expiry)", () => {
  it("sweeps a dead session on its own timer, with no new registration", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      const h = Hermes.create({ dbPath: ":memory:" });
      h.register("ghost", NOW);
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
      h.register("fresh", NOW);
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

describe("messaging", () => {
  // The methods default `now` to real Date.now(), so pass NOW to line up with the fixtures' cutoff.
  const send = (
    from: string,
    input: Parameters<Hermes["sendMessage"]>[0],
    at: number = NOW,
  ) => hermes.sendMessage(input, from, at);
  const inbox = (sessionId: string, at: number = NOW) =>
    hermes.checkMessages(sessionId, at);
  const peek = (sessionId: string, at: number = NOW) =>
    hermes.peekMessages(sessionId, at);

  it("delivers a direct message to the named live session", () => {
    register("alice", { description: "a" }, NOW);
    register("bob", { description: "b" }, NOW);
    expect(send("alice", { to: "bob", message: "ping" })).toEqual({
      delivered: 1,
    });
    expect(inbox("bob").messages).toEqual([
      { from: "alice", message: "ping", at: "just now" },
    ]);
  });

  it("draining the inbox clears it; a second drain is empty", () => {
    register("alice", { description: "a" }, NOW);
    register("bob", { description: "b" }, NOW);
    send("alice", { to: "bob", message: "one" });
    expect(inbox("bob").messages).toHaveLength(1);
    expect(inbox("bob").messages).toEqual([]);
  });

  it("peek shows waiting messages without clearing them", () => {
    register("alice", { description: "a" }, NOW);
    register("bob", { description: "b" }, NOW);
    send("alice", { to: "bob", message: "still here" });
    expect(peek("bob").messages.map((m) => m.message)).toEqual(["still here"]);
    expect(peek("bob").messages.map((m) => m.message)).toEqual(["still here"]);
    // Still drainable after peeking.
    expect(inbox("bob").messages).toHaveLength(1);
  });

  it("keeps messages in send order, oldest first", () => {
    register("alice", { description: "a" }, NOW);
    register("bob", { description: "b" }, NOW);
    send("alice", { to: "bob", message: "first" }, NOW);
    send("alice", { to: "bob", message: "second" }, NOW + 1000);
    expect(inbox("bob", NOW + 2000).messages.map((m) => m.message)).toEqual([
      "first",
      "second",
    ]);
  });

  it("delivers nothing when the recipient is not live", () => {
    register("alice", { description: "a" }, NOW);
    expect(send("alice", { to: "ghost", message: "anyone?" })).toEqual({
      delivered: 0,
    });
    expect(peek("ghost").messages).toEqual([]);
  });

  it("delivers nothing to a recipient that has gone stale", () => {
    register("bob", { description: "b" }, NOW);
    register("alice", { description: "a" }, NOW + 10 * 60_000);
    // bob was last seen 10 min ago — past the cutoff at send time.
    expect(
      send("alice", { to: "bob", message: "late" }, NOW + 10 * 60_000),
    ).toEqual({ delivered: 0 });
  });

  it("lets a session send a message to itself", () => {
    register("alice", { description: "a" }, NOW);
    expect(send("alice", { to: "alice", message: "note to self" })).toEqual({
      delivered: 1,
    });
    expect(inbox("alice").messages).toEqual([
      { from: "alice", message: "note to self", at: "just now" },
    ]);
  });

  it("delivers even when the sender isn't registered — only the recipient must be live", () => {
    register("bob", { description: "b" }, NOW);
    // alice never registered, but her id identifies her as the sender.
    expect(send("alice", { to: "bob", message: "hi" })).toEqual({
      delivered: 1,
    });
    expect(inbox("bob").messages).toEqual([
      { from: "alice", message: "hi", at: "just now" },
    ]);
  });

  it("attributes each message to its own sender", () => {
    register("alice", { description: "a" }, NOW);
    register("carol", { description: "c" }, NOW);
    register("bob", { description: "b" }, NOW);
    send("alice", { to: "bob", message: "from a" }, NOW);
    send("carol", { to: "bob", message: "from c" }, NOW + 1000);
    expect(inbox("bob", NOW + 2000).messages).toEqual([
      { from: "alice", message: "from a", at: "just now" },
      { from: "carol", message: "from c", at: "just now" },
    ]);
  });

  it("drops the inbox when the recipient deregisters", () => {
    register("alice", { description: "a" }, NOW);
    register("bob", { description: "b" }, NOW);
    send("alice", { to: "bob", message: "bye soon" });
    hermes.deregister("bob");
    expect(peek("bob").messages).toEqual([]);
  });

  it("pullIfIdle drains waiting messages when the recipient is idle", () => {
    register("alice", { description: "a" }, NOW);
    hermes.register("bob", NOW); // idle by default
    send("alice", { to: "bob", message: "wake up" });
    expect(hermes.pullIfIdle("bob", NOW).messages).toEqual([
      { from: "alice", message: "wake up", at: "just now" },
    ]);
    // drained on read, so a second pull is empty
    expect(hermes.pullIfIdle("bob", NOW).messages).toEqual([]);
  });

  it("pullIfIdle delivers nothing while the recipient is busy, leaving the inbox intact", () => {
    register("alice", { description: "a" }, NOW);
    hermes.register("bob", NOW);
    hermes.setStatus({ status: "busy" }, "bob", NOW);
    send("alice", { to: "bob", message: "later" });
    expect(hermes.pullIfIdle("bob", NOW).messages).toEqual([]);
    // still waiting — the Stop hook delivers these at turn-end
    expect(peek("bob").messages).toHaveLength(1);
  });

  it("checkMessages drains even while busy — the Stop-hook path ignores status", () => {
    register("alice", { description: "a" }, NOW);
    hermes.register("bob", NOW);
    hermes.setStatus({ status: "busy" }, "bob", NOW);
    send("alice", { to: "bob", message: "turn-end" });
    // unlike pullIfIdle, checkMessages drains regardless of status
    expect(inbox("bob").messages).toEqual([
      { from: "alice", message: "turn-end", at: "just now" },
    ]);
    expect(peek("bob").messages).toEqual([]); // and clears on read
  });

  it("pullIfIdle returns nothing for an unregistered session", () => {
    expect(hermes.pullIfIdle("ghost", NOW).messages).toEqual([]);
  });

  it("the sweeper clears messages left to a swept recipient", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      const h = Hermes.create({ dbPath: ":memory:" });
      h.register("alice", NOW);
      h.register("bob", NOW);
      h.sendMessage({ to: "bob", message: "waiting" }, "alice", NOW);
      expect(h.peekMessages("bob", NOW).messages).toHaveLength(1);
      // Everyone goes stale; the sweeper deletes the sessions and the orphaned inbox.
      vi.setSystemTime(NOW + 10 * 60_000);
      vi.advanceTimersByTime(60_000);
      expect(h.peekMessages("bob", NOW + 10 * 60_000).messages).toEqual([]);
      h.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
