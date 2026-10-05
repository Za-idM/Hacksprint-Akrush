import { config } from "./config.js";
import { startWhatsApp, sendFromScheduler } from "./whatsapp.js";
import { startScheduler, stopScheduler } from "./reminders/scheduler.js";
import { closeDb } from "./memory/db.js";
import { setActiveReminders } from "./tools/setReminder.js";

async function main() {
  if (!config.ownerJid) {
    console.warn("[warn] OWNER_JID is empty. Reminders needs it set in .env.");
  }

  console.log(`[boot] Booting ${config.botName} on ${config.geminiModel}`);

  const onReady = () => {
    startScheduler(sendFromScheduler);
  };
  await startWhatsApp(onReady);
}

function shutdown() {
  console.log("[shutdown] Cleaning up...");
  stopScheduler();
  closeDb();
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});