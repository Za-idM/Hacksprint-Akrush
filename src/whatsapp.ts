import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import P from "pino";
import { config } from "./config.js";
import {
  detectAndTranslateToEnglish,
  transcribeVoiceNote,
  translateText,
  speakText,
} from "./translate/sarvam.js";
import { runAgent, runImageAgent } from "./agent.js";
import { saveFarmerLanguage, getFarmerProfile } from "./memory/db.js";
import { wavToOggOpus } from "./media/ffmpeg.js";
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
  const rawText =
    (m.message?.conversation ||
      m.message?.extendedTextMessage?.text ||
      "") as string;

  // In groups, only respond if the bot is explicitly mentioned
  if (isGroup) {
    const botId = sock?.user?.id;
    const mentioned = (
      m.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
    ).some((j) => j === botId);
    if (!mentioned) return;
  }

  const audioMsg = m.message?.audioMessage;
  const imageMsg = m.message?.imageMessage;

  // Images: download and diagnose via Gemini vision (with optional caption)
  if (imageMsg) {
    console.log(`[msg] ${jid}: <image, ${Math.round(Number(imageMsg.fileLength ?? 0) / 1024)}KB>`);
    try {
      const image = (await downloadMediaMessage(m, "buffer", {})) as Buffer;
      if (image.length > 8 * 1024 * 1024) {
        await sock.sendMessage(jid, { text: "That photo is too large. Please send a smaller one." });
        return;
      }
      const caption =
        imageMsg.caption ||
        (m.message?.extendedTextMessage?.text ?? "");
      let captionEn = caption.trim();
      let languageCode = config.defaultLanguageCode;
      if (captionEn) {
        try {
          const tr = await detectAndTranslateToEnglish(captionEn);
          captionEn = tr.text;
          languageCode = tr.sourceLanguageCode;
          saveFarmerLanguage(jid, languageCode);
        } catch (e) {
          console.error("[translate] caption translation failed:", e);
        }
      } else {
        const fp = getFarmerProfile(jid);
        languageCode = fp?.language_code ?? config.defaultLanguageCode;
      }
      await processAndReply(jid, "", languageCode, false, {
        imageBase64: image.toString("base64"),
        mimeType: imageMsg.mimetype || "image/jpeg",
        captionEn: captionEn || undefined,
      });
    } catch (e) {
      console.error("[image] failed:", e);
      await sock.sendMessage(jid, {
        text: "Sorry, I could not process your photo right now. Please try again in a moment.",
      });
    }
    return;
  }

  // Voice notes: download and transcribe/translate via Sarvam
  if (audioMsg) {
    console.log(`[msg] ${jid}: <voice note, ${Math.round(Number(audioMsg.fileLength ?? 0) / 1024)}KB>`);
    try {
      const audio = (await downloadMediaMessage(m, "buffer", {})) as Buffer;
      const { text: enText, languageCode } = await transcribeVoiceNote(audio);
      if (!enText.trim()) {
        await sock.sendMessage(jid, { text: "Sorry, I could not hear the voice note clearly. Please try again." });
        return;
      }
      saveFarmerLanguage(jid, languageCode);
      console.log(`[msg] ${jid} voice (${languageCode}) -> EN: ${enText.slice(0, 80)}...`);
      await processAndReply(jid, enText, languageCode);
    } catch (e) {
      console.error("[voice] transcription failed:", e);
      await sock.sendMessage(jid, {
        text: "Sorry, I could not process your voice note right now. Please try again in a moment.",
      });
    }
    return;
  }

  if (rawText.trim()) {
    // Detect language + translate to English via Sarvam
    try {
      const { text: enText, sourceLanguageCode } = await detectAndTranslateToEnglish(rawText);
      saveFarmerLanguage(jid, sourceLanguageCode);
      console.log(`[msg] ${jid} (${sourceLanguageCode}) -> EN: ${enText.slice(0, 80)}...`);
      await processAndReply(jid, enText, sourceLanguageCode);
    } catch (e) {
      console.error("[translate] failed:", e);
      // Fall back to raw text so the farmer still gets help
      await processAndReply(jid, rawText, "en-IN", true);
    }
    return;
  }

  // Documents not supported yet
  if (m.message?.documentMessage) {
    await sock.sendMessage(jid, {
      text: "Document support is coming soon! For now, please describe your question in text or send a voice note.",
    });
  }
}

async function processAndReply(
  jid: string,
  enText: string,
  languageCode: string,
  translationFailed = false,
  image?: { imageBase64: string; mimeType: string; captionEn?: string }
): Promise<void> {
  if (!sock) return;

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
    const reply = image
      ? await runImageAgent(jid, image.imageBase64, image.mimeType, image.captionEn)
      : await runAgent(jid, enText);

    // Translate the English answer back to the farmer's language
    let finalText = reply.text;
    if (languageCode !== "en-IN") {
      try {
        const tr = await translateText(reply.text, "en-IN", languageCode);
        finalText = tr.text;
      } catch (e) {
        console.error("[translate] reply translation failed:", e);
        finalText =
          "(English reply - translation service is down)\n\n" + reply.text;
      }
    }

    if (translationFailed) {
      finalText =
        "(My translation service is down, so replying in English)\n\n" + finalText;
    }

    await sock.sendMessage(jid, { text: finalText });

    // Optional voice-note reply via Sarvam TTS (WAV -> OGG/Opus for Android)
    if (config.voiceReplies) {
      try {
        const wav = await speakText(finalText, languageCode);
        if (wav && wav.length > 0) {
          const opus = await wavToOggOpus(wav);
          if (opus.length > 0) {
            await sock.sendMessage(jid, {
              audio: opus,
              ptt: true,
              mimetype: "audio/ogg; codecs=opus",
            });
          }
        }
      } catch (e) {
        console.error("[tts] voice reply failed:", e);
      }
    }
  } catch (e: any) {
    console.error("[agent] failed:", e);
    await sock.sendMessage(jid, {
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