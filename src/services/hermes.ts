import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { IsomorphicHeaders } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { registerSessionSchema, type Session } from "../schemas/hermes.js";
import { type HermesConfig } from "../types/configs.js";
import { relativeTime } from "../lib.js";

/**
 * The caller's own session id, carried in the X-Hermes-Agent header — the header value is the
 * id itself. Throws if absent or blank.
 */
function sessionIdFrom(headers: IsomorphicHeaders | undefined): string {
  const raw = headers?.["x-hermes-agent"];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) throw new Error("missing X-Hermes-Agent header");
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

  /**
   * Register the calling session, identified by its X-Hermes-Agent header. Upsert: insert on
   * first sight, else refresh the description and `last_seen`. Throws if the header is absent.
   */
  registerSession(
    input: z.infer<typeof registerSessionSchema>,
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
