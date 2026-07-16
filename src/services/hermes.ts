import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { IsomorphicHeaders } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { updateSessionSchema, type Session } from "@/schemas/hermes";
import { type HermesConfig } from "@/types/configs";
import { relativeTime } from "@/lib";
import { MissingIdentityError } from "@/errors";
import { logger } from "@/logger";

const PLACEHOLDER_DESCRIPTION = "(no description yet)";
const STALE_AFTER_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

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
  private readonly sweeper: ReturnType<typeof setInterval>;

  private constructor(private readonly db: Database.Database) {
    // A live instance always sweeps dead sessions on its own timer, independent of client traffic.
    this.sweeper = setInterval(() => {
      try {
        const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
        this.db
          .prepare(`DELETE FROM sessions WHERE last_seen < @cutoff`)
          .run({ cutoff });
      } catch (err) {
        logger.error("Session sweep failed", err);
      }
    }, SWEEP_INTERVAL_MS);
    this.sweeper.unref();
  }

  /** Open the database and ensure its schema exists. */
  static create(config: HermesConfig): Hermes {
    if (config.dbPath !== ":memory:") {
      mkdirSync(dirname(config.dbPath), { recursive: true });
    }
    const db = new Database(config.dbPath);
    if (config.dbPath !== ":memory:") db.pragma("journal_mode = WAL");
    const hermes = new Hermes(db);
    try {
      hermes.ensureSchema();
    } catch (err) {
      hermes.close(); // stop the sweeper the constructor armed
      throw err;
    }
    return hermes;
  }

  /** Close the database and stop the sweeper. Call once on shutdown. */
  close(): void {
    clearInterval(this.sweeper);
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

  /** Adds the calling session to the registry with a placeholder description. */
  register(
    headers: IsomorphicHeaders | undefined,
    now: number = Date.now(),
  ): void {
    const sessionId = sessionIdFrom(headers);
    const at = new Date(now).toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (session_id, description, registered_at, last_seen)
         VALUES (@sessionId, @description, @now, @now)
         ON CONFLICT(session_id) DO UPDATE SET last_seen = @now`,
      )
      .run({ sessionId, description: PLACEHOLDER_DESCRIPTION, now: at });
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

  /** The live sessions — seen within the cutoff — most recently seen first. Stale rows are hidden. */
  listSessions(now: number = Date.now()) {
    const cutoff = new Date(now - STALE_AFTER_MS).toISOString();
    const rows = this.db
      .prepare(
        `SELECT session_id, description, last_seen
           FROM sessions WHERE last_seen >= @cutoff ORDER BY last_seen DESC`,
      )
      .all({ cutoff }) as Pick<
      Session,
      "session_id" | "description" | "last_seen"
    >[];
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
