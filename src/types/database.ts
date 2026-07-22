// Row shapes for the Hermes SQLite tables.

export interface Session {
  terminal_id: string;
  session_id: string;
  description: string;
  registered_at: string;
  last_seen: string;
  status: string;
}

export interface Message {
  id: number;
  recipient_id: string;
  sender_id: string;
  message: string;
  created_at: string;
}
