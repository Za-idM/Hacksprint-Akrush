import { getDb } from "../memory/db.js";

export interface SetReminderArgs {
  /** Human readable time spec like "2025-12-25T18:30" or "in 10 minutes" or "* * * * *". */
  when: string;
  /** Parsed cron expression OR null if one-shot. */
  cron?: string | null;
  /** Parsed epoch ms for one-shot reminders. */
  fireAt?: number | null;
  /** The reminder text the bot will ping you with. */
  message: string;
  /** The WhatsApp JID to send the reminder to. */
  chatId: string;
}

export interface StoredReminder {
  id: number;
  chat_id: string;
  cron_expr: string | null;
  fire_at: number | null;
  message: string;
  active: number;
  created_ts: number;
}

export function setReminder(args: SetReminderArgs): string {
  if (!args.message) return "ERROR: reminder 'message' is required.";
  if (!args.cron && !args.fireAt) return "ERROR: either 'cron' or 'fireAt' is required.";

  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO reminders (chat_id, cron_expr, fire_at, message, active, created_ts) VALUES (@chat_id, @cronExpr, @fireAt, @message, 1, @createdTs)`
    )
    .run({
      chat_id: args.chatId,
      cronExpr: args.cron ?? null,
      fireAt: args.fireAt ?? null,
      message: args.message,
      createdTs: Date.now(),
    });

  return `Reminder ${res.lastInsertRowid} scheduled.`;
}

export function setActiveReminders(): StoredReminder[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM reminders WHERE active = 1`)
    .all() as StoredReminder[];
}

export function markReminderDone(id: number): void {
  const db = getDb();
  db.prepare(`UPDATE reminders SET active = 0 WHERE id = ?`).run(id);
}

export const setReminderSchema = {
  type: "object" as const,
  properties: {
    when: { type: "string", description: "Human-readable description of when to fire (informational)" },
    cron: { type: "string", description: "Standard 5-field cron expression for recurring reminders (optional if fireAt used)" },
    fireAt: { type: "number", description: "Epoch milliseconds to fire a one-shot reminder (optional if cron used)" },
    message: { type: "string", description: "Reminder text to send" },
  },
  required: ["message"],
};