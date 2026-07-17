import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { IsomorphicHeaders } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { updateSessionSchema, sendMessageSchema } from "@/schemas/hermes";
import { type Session, type Message } from "@/types/database";
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
         session_id    TEXT PRIMARY KEY,
         description   TEXT NOT NULL,
         registered_at TEXT NOT NULL,
         last_seen     TEXT NOT NULL
       );
       CREATE TABLE IF NOT EXISTS messages (
         id           INTEGER PRIMARY KEY AUTOINCREMENT,
         recipient_id TEXT NOT NULL,
         sender_id    TEXT NOT NULL,
         message      TEXT NOT NULL,
         created_at   TEXT NOT NULL
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

  /** Remove the calling session and its inbox, identified by its X-Hermes-Agent header. Unknown id is a no-op. */
  deregister(headers: IsomorphicHeaders | undefined): void {
    const sessionId = sessionIdFrom(headers);
    this.db
      .prepare(`DELETE FROM sessions WHERE session_id = @sessionId`)
      .run({ sessionId });
    this.db
      .prepare(`DELETE FROM messages WHERE recipient_id = @sessionId`)
      .run({ sessionId });
  }

  /** Send the message to the named live session. Returns 1 if delivered, 0 if that session isn't live. */
  sendMessage(
    input: z.infer<typeof sendMessageSchema>,
    headers: IsomorphicHeaders | undefined,
    now: number = Date.now(),
  ): { delivered: number } {
    const senderId = sessionIdFrom(headers);
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
      .run({ to: input.to, senderId, message: input.message, at });
    return { delivered: 1 };
  }

  /** The calling session's waiting messages, without clearing them. */
  peekMessages(
    headers: IsomorphicHeaders | undefined,
    now: number = Date.now(),
  ) {
    const recipientId = sessionIdFrom(headers);
    const rows = this.db
      .prepare(
        `SELECT sender_id, message, created_at FROM messages WHERE recipient_id = @recipientId ORDER BY id`,
      )
      .all({ recipientId }) as Pick<
      Message,
      "sender_id" | "message" | "created_at"
    >[];
    return { messages: this.formatMessages(rows, now) };
  }

  /** The calling session's waiting messages; clears them once returned (delivered). */
  checkMessages(
    headers: IsomorphicHeaders | undefined,
    now: number = Date.now(),
  ) {
    const recipientId = sessionIdFrom(headers);
    const drain = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT sender_id, message, created_at FROM messages WHERE recipient_id = @recipientId ORDER BY id`,
        )
        .all({ recipientId }) as Pick<
        Message,
        "sender_id" | "message" | "created_at"
      >[];
      this.db
        .prepare(`DELETE FROM messages WHERE recipient_id = @recipientId`)
        .run({ recipientId });
      return rows;
    });
    return { messages: this.formatMessages(drain(), now) };
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
