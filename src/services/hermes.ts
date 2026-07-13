import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { IsomorphicHeaders } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { updateSessionSchema, type Session } from "@/schemas/hermes";
import { type HermesConfig } from "@/types/configs";
import { relativeTime } from "@/lib";
import { MissingIdentityError } from "@/errors";

const PLACEHOLDER_DESCRIPTION = "(no description yet)";

// Unseen longer than this (connectors heartbeat ~60s) = dead; backstop for a kill -9 that skips deregister.
const STALE_AFTER_MS = 5 * 60_000;

/**
 * The caller's own session id, carried in the X-Hermes-Agent header — the header value is the
 * id itself. Throws if absent or blank.
 */
function sessionIdFrom(headers: IsomorphicHeaders | undefined): string {
  const raw = headers?.["x-hermes-agent"];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) throw new MissingIdentityError("Missing X-Hermes-Agent header");
  return value;
}

/** Live directory of the Claude sessions running right now — SQLite, nothing durable. */
export class Hermes {
  private constructor(private readonly db: Database.Database) {}

  /** Open the database and ensure its schema exists. */
  static create(config: HermesConfig): Hermes {
    if (config.dbPath !== ":memory:") {
      mkdirSync(dirname(config.dbPath), { recursive: true });
    }
    const db = new Database(config.dbPath);
    if (config.dbPath !== ":memory:") db.pragma("journal_mode = WAL");
    const hermes = new Hermes(db);
    hermes.ensureSchema();
    return hermes;
  }

  /** Close the database. Call once on shutdown. */
  close(): void {
    this.db.close();
  }

  private ensureSchema(): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
         session_id    TEXT PRIMARY KEY,
         description   TEXT NOT NULL,
         registered_at TEXT NOT NULL,
         last_seen     TEXT NOT NULL
       )`,
    );
  }

  /** Adds the calling session to the registry with a placeholder description, and sweeps the dead. */
  register(headers: IsomorphicHeaders | undefined, now: number = Date.now()): void {
    const sessionId = sessionIdFrom(headers);
    const at = new Date(now).toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (session_id, description, registered_at, last_seen)
         VALUES (@sessionId, @description, @now, @now)
         ON CONFLICT(session_id) DO UPDATE SET last_seen = @now`,
      )
      .run({ sessionId, description: PLACEHOLDER_DESCRIPTION, now: at });
    this.sweepStale(now);
  }

  /** Delete sessions unseen past the cutoff. Runs on the heartbeat path, keeping the read pure. */
  private sweepStale(now: number): void {
    const cutoff = new Date(now - STALE_AFTER_MS).toISOString();
    this.db.prepare(`DELETE FROM sessions WHERE last_seen < @cutoff`).run({ cutoff });
  }

  /** Update the calling session's description and `last_seen`. Upserts if not signed in yet. */
  setDescription(
    input: z.infer<typeof updateSessionSchema>,
    headers: IsomorphicHeaders | undefined,
    now: number = Date.now(),
  ): void {
    const sessionId = sessionIdFrom(headers);
    const at = new Date(now).toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (session_id, description, registered_at, last_seen)
         VALUES (@sessionId, @description, @now, @now)
         ON CONFLICT(session_id) DO UPDATE SET
           description = @description, last_seen = @now`,
      )
      .run({ sessionId, description: input.description, now: at });
  }

  /** Every registered session, most recently seen first. */
  listSessions(now: number = Date.now()) {
    const rows = this.db
      .prepare(
        `SELECT session_id, description, last_seen
           FROM sessions ORDER BY last_seen DESC`,
      )
      .all() as Pick<Session, "session_id" | "description" | "last_seen">[];
    return {
      sessions: rows.map((s) => ({
        session_id: s.session_id,
        description: s.description,
        last_seen: relativeTime(s.last_seen, now) ?? s.last_seen,
      })),
    };
  }

  /** Remove the calling session, identified by its X-Hermes-Agent header. Unknown id is a no-op. */
  deregister(headers: IsomorphicHeaders | undefined): void {
    const sessionId = sessionIdFrom(headers);
    this.db
      .prepare(`DELETE FROM sessions WHERE session_id = @sessionId`)
      .run({ sessionId });
  }

  /** The session with this id, or undefined if none is present. */
  getSession(sessionId: string): Session | undefined {
    return this.db
      .prepare(
        `SELECT session_id, description, registered_at, last_seen
           FROM sessions WHERE session_id = @sessionId`,
      )
      .get({ sessionId }) as Session | undefined;
  }
}
