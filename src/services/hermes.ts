import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import {
  updateSessionSchema,
  sendMessageSchema,
  setStatusSchema,
} from "@/schemas/hermes";
import { type Session, type Message } from "@/types/database";
import { type HermesConfig } from "@/types/configs";
import { relativeTime } from "@/lib";
import { logger } from "@/logger";

const PLACEHOLDER_DESCRIPTION = "(no description yet)";
const STALE_AFTER_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

/** Live directory of running Claude sessions. SQLite, nothing durable. */
export class Hermes {
  private readonly sweeper: ReturnType<typeof setInterval>;

  private constructor(private readonly db: Database.Database) {
    this.sweeper = setInterval(() => {
      try {
        const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
        this.db
          .prepare(`DELETE FROM sessions WHERE last_seen < @cutoff`)
          .run({ cutoff });
        // Inboxes are live-only: drop any message whose recipient is no longer a live session.
        this.db
          .prepare(
            `DELETE FROM messages WHERE recipient_id NOT IN (SELECT session_id FROM sessions)`,
          )
          .run();
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
      hermes.close();
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
         terminal_id   TEXT PRIMARY KEY,
         session_id    TEXT NOT NULL,
         description   TEXT NOT NULL,
         registered_at TEXT NOT NULL,
         last_seen     TEXT NOT NULL,
         status        TEXT NOT NULL DEFAULT 'idle'
       );
       CREATE INDEX IF NOT EXISTS session_id ON sessions(session_id);
       CREATE TABLE IF NOT EXISTS messages (
         id           INTEGER PRIMARY KEY AUTOINCREMENT,
         recipient_id TEXT NOT NULL,
         sender_id    TEXT NOT NULL,
         message      TEXT NOT NULL,
         created_at   TEXT NOT NULL
       )`,
    );
  }

  /** Add the terminal to the roster, or bump last_seen if already present. */
  register(terminalId: string, now: number = Date.now()): void {
    const at = new Date(now).toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (terminal_id, session_id, description, registered_at, last_seen)
         VALUES (@terminalId, @terminalId, @description, @now, @now)
         ON CONFLICT(terminal_id) DO UPDATE SET last_seen = @now`,
      )
      .run({ terminalId, description: PLACEHOLDER_DESCRIPTION, now: at });
  }

  /** The live session_id currently at a terminal, or undefined when the terminal isn't in the roster. */
  private sessionIdAt(terminalId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT session_id FROM sessions WHERE terminal_id = @terminalId`,
      )
      .get({ terminalId }) as Pick<Session, "session_id"> | undefined;
    return row?.session_id;
  }

  /** Delete every message queued for a session id. */
  private purgeInbox(sessionId: string): void {
    this.db
      .prepare(`DELETE FROM messages WHERE recipient_id = @sessionId`)
      .run({ sessionId });
  }

  /** The live session_id currently at a terminal, or the terminal id itself when it isn't in the roster yet. */
  resolveSession(terminalId: string): string {
    return this.sessionIdAt(terminalId) ?? terminalId;
  }

  /** Point a terminal at its live session; on a session change, reset it to start clean and clear the old inbox. */
  setSession(
    terminalId: string,
    sessionId: string,
    now: number = Date.now(),
  ): void {
    const previous = this.sessionIdAt(terminalId);
    const at = new Date(now).toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (terminal_id, session_id, description, registered_at, last_seen, status)
         VALUES (@terminalId, @sessionId, @description, @now, @now, 'idle')
         ON CONFLICT(terminal_id) DO UPDATE SET
           last_seen     = @now,
           session_id    = excluded.session_id,
           description   = CASE WHEN session_id = excluded.session_id THEN description   ELSE excluded.description   END,
           registered_at = CASE WHEN session_id = excluded.session_id THEN registered_at ELSE excluded.registered_at END,
           status        = CASE WHEN session_id = excluded.session_id THEN status        ELSE 'idle'                 END`,
      )
      .run({
        terminalId,
        sessionId,
        description: PLACEHOLDER_DESCRIPTION,
        now: at,
      });
    if (previous && previous !== sessionId) this.purgeInbox(previous);
  }

  /** Set the terminal's description and bump `last_seen`. Upserts a placeholder row if the terminal is new. */
  setDescription(
    input: z.infer<typeof updateSessionSchema>,
    terminalId: string,
    now: number = Date.now(),
  ): void {
    const at = new Date(now).toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (terminal_id, session_id, description, registered_at, last_seen)
         VALUES (@terminalId, @terminalId, @description, @now, @now)
         ON CONFLICT(terminal_id) DO UPDATE SET
           description = @description, last_seen = @now`,
      )
      .run({ terminalId, description: input.description, now: at });
  }

  /** Mark the terminal busy or idle and bump `last_seen`. Upserts a placeholder row if the terminal is new. */
  setStatus(
    input: z.infer<typeof setStatusSchema>,
    terminalId: string,
    now: number = Date.now(),
  ): void {
    const at = new Date(now).toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (terminal_id, session_id, description, registered_at, last_seen, status)
         VALUES (@terminalId, @terminalId, @description, @now, @now, @status)
         ON CONFLICT(terminal_id) DO UPDATE SET status = @status, last_seen = @now`,
      )
      .run({
        terminalId,
        description: PLACEHOLDER_DESCRIPTION,
        now: at,
        status: input.status,
      });
  }

  /** The live sessions, most recently seen first; stale rows are hidden. */
  listSessions(now: number = Date.now()) {
    const cutoff = new Date(now - STALE_AFTER_MS).toISOString();
    const rows = this.db
      .prepare(
        `SELECT session_id, description, last_seen, status
           FROM sessions WHERE last_seen >= @cutoff ORDER BY last_seen DESC`,
      )
      .all({ cutoff }) as Pick<
      Session,
      "session_id" | "description" | "last_seen" | "status"
    >[];
    return {
      sessions: rows.map((s) => ({
        session_id: s.session_id,
        description: s.description,
        last_seen: relativeTime(s.last_seen, now) ?? s.last_seen,
        status: s.status,
      })),
    };
  }

  /** Remove a terminal and its session's inbox. Unknown terminal is a no-op. */
  deregister(terminalId: string): void {
    const sessionId = this.sessionIdAt(terminalId);
    this.db
      .prepare(`DELETE FROM sessions WHERE terminal_id = @terminalId`)
      .run({ terminalId });
    if (sessionId) this.purgeInbox(sessionId);
  }

  /** Send the message to the named live session. Returns 1 if delivered, 0 if that session isn't live. */
  sendMessage(
    input: z.infer<typeof sendMessageSchema>,
    sessionId: string,
    now: number = Date.now(),
  ): { delivered: number } {
    const cutoff = new Date(now - STALE_AFTER_MS).toISOString();
    const recipient = this.db
      .prepare(
        `SELECT session_id FROM sessions WHERE session_id = @to AND last_seen >= @cutoff`,
      )
      .get({ to: input.to, cutoff });
    if (!recipient) return { delivered: 0 };
    const at = new Date(now).toISOString();
    this.db
      .prepare(
        `INSERT INTO messages (recipient_id, sender_id, message, created_at)
         VALUES (@to, @senderId, @message, @at)`,
      )
      .run({ to: input.to, senderId: sessionId, message: input.message, at });
    return { delivered: 1 };
  }

  /** Return the calling session's waiting messages without clearing them. */
  peekMessages(sessionId: string, now: number = Date.now()) {
    const rows = this.db
      .prepare(
        `SELECT sender_id, message, created_at FROM messages WHERE recipient_id = @sessionId ORDER BY id`,
      )
      .all({ sessionId }) as Pick<
      Message,
      "sender_id" | "message" | "created_at"
    >[];
    return { messages: this.formatMessages(rows, now) };
  }

  /** Return and clear the calling session's waiting messages. */
  checkMessages(sessionId: string, now: number = Date.now()) {
    const drain = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT sender_id, message, created_at FROM messages WHERE recipient_id = @sessionId ORDER BY id`,
        )
        .all({ sessionId }) as Pick<
        Message,
        "sender_id" | "message" | "created_at"
      >[];
      this.db
        .prepare(`DELETE FROM messages WHERE recipient_id = @sessionId`)
        .run({ sessionId });
      return rows;
    });
    return { messages: this.formatMessages(drain(), now) };
  }

  /** Return and clear the calling session's waiting messages when idle; none if busy. */
  pullIfIdle(sessionId: string, now: number = Date.now()) {
    const idle = this.db
      .prepare(
        `SELECT 1 FROM sessions WHERE session_id = @sessionId AND status = 'idle'`,
      )
      .get({ sessionId });
    if (!idle) return { messages: [] };
    return this.checkMessages(sessionId, now);
  }

  private formatMessages(
    rows: Pick<Message, "sender_id" | "message" | "created_at">[],
    now: number,
  ) {
    return rows.map((m) => ({
      from: m.sender_id,
      message: m.message,
      at: relativeTime(m.created_at, now) ?? m.created_at,
    }));
  }

  /** The roster row for this session id, or undefined if none is present. */
  getSession(sessionId: string): Session | undefined {
    return this.db
      .prepare(
        `SELECT terminal_id, session_id, description, registered_at, last_seen, status
           FROM sessions WHERE session_id = @sessionId`,
      )
      .get({ sessionId }) as Session | undefined;
  }
}
