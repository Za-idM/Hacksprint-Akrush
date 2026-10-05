# Akrush — WhatsApp Farmer Helpline

An agricultural helpline chatbot on WhatsApp. Farmers send text, voice notes, or photos of crops in any Indian language — **Sarvam AI** handles all language work (detection, translation, speech) and **Gemini** answers the query. Akrush replies in the farmer's own language, as text and a voice note.

## Features

- **Multilingual text**: farmer's message auto-detected + translated to English (Sarvam Mayura, 12 languages w/ auto-detect)
- **Voice notes in**: WhatsApp voice notes → Sarvam Saaras speech-to-text (direct translation to English, 22 languages)
- **Voice notes out**: replies synthesized by Sarvam Bulbul TTS and sent as PTT voice notes (11 languages)
- **Crop photo diagnosis**: photo (with or without caption) → Gemini vision → likely problem, next steps, KVK dosage disclaimer
- **Per-farmer memory**: language, village, crops, land size, soil, irrigation stored in SQLite (agent saves facts automatically via `update_farmer_profile` tool)
- **Reminders**: crop-stage, irrigation, spray, and task reminders (node-cron + SQLite)
- **Email escalation**: forward unresolved queries to an expert/agronomist (Nodemailer)

## Stack

| Layer | Choice |
|-------|--------|
| WhatsApp | [Baileys](https://github.com/WhiskeySockets/Baileys) |
| Translation | [Sarvam Translate](https://docs.sarvam.ai) (`mayura:v1`, auto-detect) |
| Speech-to-text | Sarvam `saaras:v3` (`mode=translate` → English) |
| Text-to-speech | Sarvam `bulbul:v3` (WAV → ffmpeg OGG/Opus for WhatsApp) |
| AI brain | [Gemini 2.5 Flash](https://ai.google.dev) (tool-calling + vision) |
| Reminders | node-cron + SQLite |
| Memory | SQLite (better-sqlite3) |
| Audio conversion | ffmpeg-static |
| Runtime | Node.js 20+ + TypeScript (ESM) |
| Process | PM2 (auto-restart on crash / on boot) |

## Pipeline

```
Farmer (text/voice/photo, any Indian language)
  → Sarvam: detect + translate to English (voice: saaras:v3 mode=translate)
  → Gemini: answer with tools (reminders, farmer profile, email)
  → Sarvam: translate reply back to farmer's language
  → Farmer receives: text + voice note (bulbul:v3)
```

## Prerequisites

- Node.js 20+ (`node -v`)
- API keys:
  - **Sarvam** (translation + speech) — <https://dashboard.sarvam.ai>
  - **Gemini** (AI brain) — <https://aistudio.google.com/apikey> (free tier works)
  - **Gmail App Password** (for the email tool) — enable 2FA, then <https://myaccount.google.com/apppasswords>
- A **secondary SIM** with WhatsApp installed (do NOT use your main number — automation carries a small ban risk)

## Configure

```bash
cp .env.example .env
# then edit .env:
```

```env
SARVAM_API_KEY=sk_xxxxxxxxxxxxxxxx
GEMINI_API_KEY=AIzaxxxxxxxxxxxxxxxx
EMAIL_USER=yourbot@gmail.com
EMAIL_PASS=abcd efgh ijkl mnop     # 16-char Gmail App Password
OWNER_JID=919876543210@s.whatsapp.net   # your personal number, intl format, no +
VOICE_REPLIES=true                 # send voice-note replies (Sarvam TTS)
```

Optional:
- `GEMINI_MODEL` (default `gemini-2.5-flash`)
- `DEFAULT_LANGUAGE_CODE` (fallback language when detection fails, default `en-IN`)
- `REPLY_DELAY_MIN/MAX`, `RATE_LIMIT_PER_MIN`, `HISTORY_LIMIT` (anti-spam/context)

## Build & Run (one-off test)

```bash
npm install
npm run build
npm start
```

On first run, a QR code prints in the terminal. Open WhatsApp **on the phone with the bot's SIM**, go to Settings → Linked Devices → Link a Device → scan the QR.

Then DM the bot number from your personal phone:

- A Hindi/Marathi text: *"मेरी फसल में कीड़े लग गए हैं, क्या करूँ?"*
- A voice note in any Indian language
- A photo of a sick crop with or without a caption
- "Remind me tomorrow at 6am to irrigate the field"
- Replies come back in the farmer's language, as text + voice note

## Deploy on Raspberry Pi 4 (24/7)

4GB RAM is more than enough (bot idles at <200MB).

```bash
# SSH into the Pi, then:
sudo apt update && sudo apt install -y git build-essential python3

# Install Node 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20 && nvm use 20

# Get the code
git clone https://github.com/<you>/whatsapp-ai-bot.git
cd whatsapp-ai-bot
cp .env.example .env && nano .env   # fill in keys

# Build & test once
npm install
npm run build
npm start    # scan QR

# Run 24/7 with PM2 (auto-restart on crash + reboot)
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd        # follow the instructions it prints
pm2 logs wab               # live logs (Ctrl+C to exit)
```

Update code later: `git pull && npm install && npm run build && pm2 restart wab`

> `data/auth` holds the WhatsApp session — never delete it, or you'll have to re-scan the QR.

## Anti-spam safeguards (built in)

- **Replies only to incoming messages** — never initiates conversations (except scheduled reminders)
- **Random reply delay**: 5–15 seconds before responding (`REPLY_DELAY_MIN/MAX`)
- **Per-chat rate limit**: max 20 messages/min/chat (`RATE_LIMIT_PER_MIN`)
- **Group messages ignored unless the bot is `@mentioned`**

## Project layout

```
whatsapp-ai-bot/
├── src/
│   ├── index.ts              # entry, boot sequence, graceful shutdown
│   ├── whatsapp.ts           # Baileys socket, QR, message routing (text/voice/image), rate limit + delay
│   ├── agent.ts              # Gemini tool-calling loop + image-diagnosis agent
│   ├── config.ts             # env loading
│   ├── translate/
│   │   └── sarvam.ts         # Sarvam: translate, STT (voice), TTS (voice replies)
│   ├── media/
│   ├── memory/
│   │   ├── db.ts             # SQLite: messages, reminders, farmer profiles + language
│   │   └── profile.ts        # loads data/profile.md as the bot persona
│   ├── tools/
│   │   ├── registry.ts       # provider-agnostic tool declarations + dispatcher
│   │   ├── sendEmail.ts      # Nodemailer (expert escalation)
│   │   └── setReminder.ts    # persists reminders to SQLite
│   └── reminders/
│       └── scheduler.ts      # node-cron manager, pings farmer when due
├── data/
│   ├── auth/                 # Baileys session creds (gitignored)
│   ├── bot.db                # SQLite DB (gitignored)
│   └── profile.md            # Akrush persona / system prompt
├── .env.example
├── ecosystem.config.cjs      # PM2 process config
├── package.json
└── tsconfig.json
```

## Adding more skills

Each skill is one file in `src/tools/`:

1. Create `src/tools/foo.ts` exporting a function and a JSON schema (OpenAPI-style).
2. Register it in `src/tools/registry.ts` `TOOLS` array (schemas are auto-converted to Gemini's format).
3. The agent loop exposes it to Gemini and dispatches calls.

Good candidates: weather (IMD/OpenWeatherMap), mandi prices (Agmarknet), govt-scheme lookup, soil advisory.

## Troubleshooting

**Bot not replying**: check `pm2 logs wab`. Common causes — missing `SARVAM_API_KEY`/`GEMINI_API_KEY`, WhatsApp not connected, or a group message without `@mention`.

**Voice notes play on WhatsApp Web but not on Android**: Android requires OGG/Opus. Replies are converted from WAV with ffmpeg (`ffmpeg-static`, bundled). On the Pi, ffmpeg-static works on ARM too.

**Translation failing**: check the Sarvam key and quota (`429` = quota exceeded). The bot falls back to replying in English so the farmer still gets help.

**`better-sqlite3` install fails**: ensure build tools: `sudo apt install -y build-essential python3`.

**Logged out of WhatsApp**: delete the session and re-scan:
```bash
pm2 stop wab && rm -rf data/auth && pm2 start wab
```

## ToS note

Using unofficial WhatsApp libraries (Baileys) technically violates WhatsApp's Terms of Service. Use a secondary SIM, keep volumes low, and don't expect this to be a bulletproof production setup. For a real public farmer helpline, apply for the official [WhatsApp Business API](https://business.whatsapp.com/developers/developer-hub).
