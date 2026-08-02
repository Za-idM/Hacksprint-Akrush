import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import P from "pino";
import { config } from "./config.js";
import { runAgent } from "./agent.js";

const logger = P({ level: "info" });

let sock: WASocket | null = null;

// Simple per-chat rate limiter
const rateBuckets = new Map<string, number[]>();
function rateOk(chatId: string): boolean {
  const now = Date.now();
  const arr = (rateBuckets.get(chatId) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  rateBuckets.set(chatId, arr);
  return arr.length <= config.rateLimitPerMin;
}

export function getRateLimitCount(chatId: string): number {
  return rateBuckets.get(chatId)?.length ?? 0;
}

export async function startWhatsApp(onReady: () => void): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(config.paths.auth);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "warn" }),
    printQRInTerminal: false,
    browser: ["whatsapp-ai-bot", "chrome", "1.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n===== SCAN THIS QR WITH WHATSAPP =====\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("[whatsapp] Connected successfully.");
      onReady();
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      console.log(`[whatsapp] Closed. Code: ${code}`);
      if (code !== DisconnectReason.loggedOut && code !== 401) {
        setTimeout(() => startWhatsApp(onReady), 5000);
      } else {
        console.error("[whatsapp] Logged out. Delete data/auth and re-scan.");
        process.exit(1);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      await handleMessage(m);
    }
  });
}

async function handleMessage(m: proto.IWebMessageInfo): Promise<void> {
  if (!sock) return;

  // Skip the bot's own messages and status broadcasts
  if (m.key.fromMe) return;
  if (m.key.remoteJid === "status@broadcast") return;

  const jid = m.key.remoteJid;
  if (!jid) return;

  // Groups: only reply when mentioned OR if owner DMs you from a 1:1 chat
  const isGroup = jid.endsWith("@g.us");
  const text =
    (m.message?.conversation ||
      m.message?.extendedTextMessage?.text ||
      "") as string;
  if (!text.trim()) return;

  // In groups, only respond if the bot is explicitly mentioned
  if (isGroup) {
    const botId = sock?.user?.id;
    const mentioned = (
      m.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
    ).some((j) => j === botId);
    if (!mentioned) return;
  }

  console.log(`[msg] ${jid}: ${text.slice(0, 80)}...`);

  if (!rateOk(jid)) {
    console.warn(`[rate] ${jid} throttled.`);
    return;
  }

  // Random reply delay (anti-spam) 5-15s
  const delayMs =
    1000 *
    (config.replyDelayMin +
      Math.random() * (config.replyDelayMax - config.replyDelayMin));

  await sleep(delayMs);

  try {
    const reply = await runAgent(jid, text);
    await sock!.sendMessage(jid, { text: reply.text });
  } catch (e: any) {
    console.error("[agent] failed:", e);
    await sock!.sendMessage(jid, {
      text: "Hmm, something broke on my end. Try again in a moment.",
    });
  }
}

export async function sendFromScheduler(
  jid: string,
  text: string
): Promise<void> {
  if (!sock) return;
  await sock.sendMessage(jid, { text });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}