# WhatsApp AI Bot

A personal WhatsApp AI assistant running on a Raspberry Pi 4. Talks to you on WhatsApp, knows who you are via a `profile.md` system prompt, and can use tools (send email, set reminders).

## Stack

| Layer | Choice |
|-------|--------|
| WhatsApp | [Baileys](https://github.com/WhiskeySockets/Baileys) |
| AI brain | [Groq](https://groq.com) + Llama 3.3 70B (free tier) |
| Email | Nodemailer + Gmail App Password |
| Reminders | node-cron + SQLite |
| Memory | SQLite (better-sqlite3) |
| Runtime | Node.js 20 + TypeScript (ESM) |
| Process | PM2 (auto-restart on crash / on boot) |

## Prerequisites

You'll need:

- A **Raspberry Pi 4** (4GB RAM is fine) running **Pi OS Lite 64-bit**, headless, SSH'd in
- A **secondary SIM** with WhatsApp installed (do NOT use your main number — automation carries a small ban risk even with anti-spam safeguards)
- A **Groq API key** — free at <https://console.groq.com/keys>
- A **Gmail account** with 2FA enabled + an **App Password** — generate one at <https://myaccount.google.com/apppasswords>

## Get the code on the Pi

From this Windows machine (where you scaffolded the project):

```bash
cd C:\Users\Zaid Mujawar\whatsapp-ai-bot
git init
git add .
git commit -m "init: whatsapp ai bot scaffold"
# then create an empty GitHub repo and:
git remote add origin https://github.com/<you>/whatsapp-ai-bot.git
git push -u origin main
```

On the Pi:

```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/<you>/whatsapp-ai-bot.git
cd whatsapp-ai-bot
```

## Install Node 20 (if not already)

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node -v   # should print v20.x.x
```

> `better-sqlite3` is a native module — it will compile on the Pi during `npm install`. If it fails, ensure you have build tools:
> ```bash
> sudo apt install -y build-essential python3
> ```

## Configure

```bash
cp .env.example .env
nano .env
```

Fill in:

```env
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx
EMAIL_USER=yourbot@gmail.com
EMAIL_PASS=abcd efgh ijkl mnop     # 16-char Gmail App Password (with or without spaces)
EMAIL_FROM_NAME=Zaid Bot
EMAIL_FROM_ADDRESS=yourbot@gmail.com
OWNER_JID=919876543210@s.whatsapp.net   # your personal WhatsApp number, intl format, no +
REPLY_DELAY_MIN=5
REPLY_DELAY_MAX=15
```

Then edit your personal context:

```bash
nano data/profile.md
```

Replace the placeholder lines (`Zaid Mujawar`, city, job, interests, timezone) with your real info. The AI sees this whole file as its system prompt.

## Build & Run (one-off test)

```bash
npm install
npm run build
npm start
```

On first run, a QR code prints in the terminal. Open WhatsApp **on the phone with your secondary SIM**, go to Settings → Linked Devices → Link a Device → scan the QR.

Once connected, the bot sits waiting. DM it from your personal phone and say "hi".

## Run with PM2 (24/7, auto-restart on boot)

```bash
sudo npm install -g pm2
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd        # follow the instructions it prints
# (usually): sudo env PATH=$PATH:/home/<you>/.nvm/versions/node/v20.x.x/bin pm2 startup systemd -u <you> --hp /home/<you>
pm2 restart wab            # apply changes after editing code
pm2 logs wab              # live logs (Ctrl+C to exit)
```

## Using it

From your personal WhatsApp, message your secondary SIM:

- "Hey, who are you?"
- "Email mom@example.com subject 'Dinner plan' body 'Coming at 8'"
- "Remind me in 5 minutes to check the oven" *(LLM converts to `fireAt`)*
- "Remind me every weekday at 09:00 to stand up" *(LLM converts to cron `0 9 * * 1-5`)*

## Anti-spam safeguards (built in)

Per the Reddit advice that motivated this project, the bot:

- **Replies only to incoming messages** — never initiates conversations (except scheduled reminders)
- **Random reply delay**: 5–15 seconds by default before responding (see `REPLY_DELAY_MIN/MAX`)
- **Per-chat rate limit**: max 20 messages/min/chat (see `RATE_LIMIT_PER_MIN`)
- **Ignores group messages unless explicitly `@mentioned`** — won't spam group chats

To stay extra safe, keep message volumes low and avoid sending identical broadcast texts to many different chats.

## Project layout

```
whatsapp-ai-bot/
├── src/
│   ├── index.ts              # entry, boot sequence, graceful shutdown
│   ├── whatsapp.ts           # Baileys socket, QR, message handler, rate limit + delay
│   ├── agent.ts              # Groq tool-calling loop, system prompt assembly
│   ├── config.ts             # env loading
│   ├── memory/
│   │   ├── db.ts             # SQLite schema, saveMessage/getHistory
│   │   └── profile.ts        # loads data/profile.md as system prompt
│   ├── tools/
│   │   ├── registry.ts       # TOOLS array + dispatcher
│   │   ├── sendEmail.ts      # Nodemailer skill
│   │   └── setReminder.ts    # persists reminders to SQLite
│   └── reminders/
│       └── scheduler.ts      # node-cron manager, pings user via Baileys when due
├── data/
│   ├── auth/                 # Baileys session creds (gitignored)
│   ├── bot.db                # SQLite DB (gitignored)
│   └── profile.md            # your personal context for the AI
├── .env.example
├── .gitignore
├── ecosystem.config.cjs      # PM2 process config
├── package.json
├── tsconfig.json
└── README.md
```

## Adding more skills

Each skill is one file in `src/tools/`. Pattern:

1. Create `src/tools/foo.ts` exporting a `foo()` function and a JSON schema.
2. Register it in `src/tools/registry.ts` `TOOLS` array with its `run` handler.
3. The agent loop automatically exposes it to the LLM and dispatches calls.

Good candidates: web search (Brave), weather (OpenWeatherMap), Google Calendar, Home Assistant, expense logger.

## Troubleshooting

**QR keeps scrolling / not scanning**: terminal width may be too small. Try `qrcode.generate(qr, { small: true })` already enabled; otherwise widen your SSH terminal.

**`better-sqlite3` install fails**: ensure build tools are present: `sudo apt install -y build-essential python3`.

**Bot not replying**: check `pm2 logs wab`. Common causes — empty `GROQ_API_KEY`, wrong Gmail App Password, or the message came from a group you weren't `@mentioned` in.

**Logged out of WhatsApp**: if you see `DisconnectReason.loggedOut`, delete the session and re-scan:
```bash
pm2 stop wab
rm -rf data/auth
pm2 start wab
```

## ToS note

Using unofficial WhatsApp libraries (Baileys) technically violates WhatsApp's Terms of Service. Use a secondary SIM, keep volumes low, and don't expect this to be a bulletproof production setup. For commercial use, apply for the [official WhatsApp Business API](https://business.whatsapp.com/developers/developer-hub).
