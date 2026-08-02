import cron from "node-cron";
import type { proto } from "@whiskeysockets/baileys";
import { setActiveReminders, markReminderDone, type StoredReminder } from "../tools/setReminder.js";

type SendMessageFn = (jid: string, text: string) => Promise<proto.IMessage | void>;

const jobs = new Map<number, () => void>();

export function startScheduler(sendMessage: SendMessageFn): void {
  const reminders = setActiveReminders();
  for (const r of reminders) scheduleOne(r, sendMessage);
  console.log(`[scheduler] Loaded ${reminders.length} active reminders.`);
}

function scheduleOne(r: StoredReminder, sendMessage: SendMessageFn): void {
  const fire = async () => {
    try {
      await sendMessage(r.chat_id, `⏰ Reminder: ${r.message}`);
    } catch (e) {
      console.error("[scheduler] failed to send reminder", e);
    } finally {
      if (r.fire_at != null) markReminderDone(r.id);
    }
  };

  if (r.cron_expr) {
    const task = cron.schedule(r.cron_expr, fire);
    jobs.set(r.id, () => task.stop());
  } else if (r.fire_at != null) {
    const delay = r.fire_at - Date.now();
    if (delay <= 0) {
      fire();
    } else {
      const timer = setTimeout(fire, delay);
      jobs.set(r.id, () => clearTimeout(timer));
    }
  }
}

export function registerReminder(r: StoredReminder, sendMessage: SendMessageFn): void {
  scheduleOne(r, sendMessage);
}

export function stopScheduler(): void {
  for (const stop of jobs.values()) stop();
  jobs.clear();
}