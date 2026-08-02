import Database from "better-sqlite3";
import { config } from "../config.js";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(config.paths.db);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,            -- 'user' | 'assistant' | 'tool'
      content TEXT NOT NULL,
      tool_call_id TEXT,
      tool_name TEXT,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, ts DESC);

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      cron_expr TEXT,
      fire_at INTEGER,            -- epoch ms for one-shot
      message TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_active ON reminders(active) WHERE active = 1;
  `);
}

export interface StoredMessage {
  id: number;
  chat_id: string;
  role: string;
  content: string;
  tool_call_id: string | null;
  tool_name: string | null;
  ts: number;
}

export function saveMessage(msg: Omit<StoredMessage, "id" | "ts">): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, tool_call_id, tool_name, ts) VALUES (@chat_id, @role, @content, @tool_call_id, @tool_name, @ts)`
  ).run({ ...msg, ts: Date.now() });
}

export function getHistory(chatId: string, limit: number): StoredMessage[] {
  const db = getDb();
  return (
    db
      .prepare(`SELECT * FROM messages WHERE chat_id = ? ORDER BY ts DESC LIMIT ?`)
      .all(chatId, limit) as StoredMessage[]
  ).reverse();
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}