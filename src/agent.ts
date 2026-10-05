import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { config } from "./config.js";
import { loadProfile } from "./memory/profile.js";
import { getHistory, saveMessage, getFarmerProfile } from "./memory/db.js";
import { TOOLS, dispatchTool, type ToolContext } from "./tools/registry.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const toolDeclarations = TOOLS.map((t) => t.declaration);

const globalProfile = loadProfile();

function buildSystemPrompt(chatId: string): string {
  const farmer = getFarmerProfile(chatId);
  const farmerCtx = farmer?.profile_json
    ? JSON.stringify(JSON.parse(farmer.profile_json), null, 2)
    : "Not yet known. Ask the farmer about their village, crops, land size, soil and irrigation when relevant, and save facts with update_farmer_profile.";

  const now = new Date().toISOString();
  return `${globalProfile}

# Current UTC time
${now}

# Farmer profile (from memory)
${farmerCtx}

# Language rules
- The farmer's message has already been translated to English. Reply in clear, simple English.
- Keep answers short (WhatsApp-friendly), practical, and actionable for a small-holding farmer.
- Use metric/local units (acres, kg, quintal). Never give exact pesticide dosages without advising to confirm with the local KVK/agriculture officer.

# Tool use rules
- Use set_reminder for crop-stage, irrigation, spray, or task reminders. For recurring, use "cron" (5-field). For one-shot, use "fireAt" (epoch ms).
- Use update_farmer_profile to persist facts the farmer shares about their farm.
- Use send_email only to escalate to an expert or when the farmer explicitly asks.
- Always confirm before irreversible side-effects unless the farmer clearly says "go ahead".
- If unsure about an answer, say so honestly and suggest contacting the nearest KVK helpline.`;
}

export interface AgentReply {
  text: string;
}

function historyToContents(chatId: string): Content[] {
  const history = getHistory(chatId, config.historyLimit);
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }] as Part[],
    }));
}

export async function runAgent(
  chatId: string,
  userText: string
): Promise<AgentReply> {
  const ctx: ToolContext = { chatId };

  saveMessage({ chat_id: chatId, role: "user", content: userText, tool_call_id: null, tool_name: null });

  const contents: Content[] = [
    ...historyToContents(chatId),
    { role: "user", parts: [{ text: userText }] },
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 4;

  while (iterations++ < MAX_ITERATIONS) {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents,
      config: {
        systemInstruction: buildSystemPrompt(chatId),
        tools: [{ functionDeclarations: toolDeclarations }],
        temperature: 0.6,
      },
    });

    const functionCalls = response.functionCalls;

    if (functionCalls && functionCalls.length > 0) {
      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) contents.push(modelContent);

      for (const call of functionCalls) {
        if (!call.name) continue;
        const result = await dispatchTool(call.name, call.args ?? {}, ctx);
        saveMessage({
          chat_id: chatId,
          role: "tool",
          content: result,
          tool_call_id: call.id ?? null,
          tool_name: call.name,
        });
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: call.name,
                response: { result },
              },
            } as Part,
          ],
        });
      }
      continue;
    }

    const text = response.text || "";
    saveMessage({ chat_id: chatId, role: "assistant", content: text, tool_call_id: null, tool_name: null });
    return { text };
  }

  const fallback = "Sorry, I got stuck in a tool loop. Try rephrasing?";
  saveMessage({ chat_id: chatId, role: "assistant", content: fallback, tool_call_id: null, tool_name: null });
  return { text: fallback };
}

export async function runImageAgent(
  chatId: string,
  imageBase64: string,
  mimeType: string,
  captionEn?: string
): Promise<AgentReply> {
  const farmer = getFarmerProfile(chatId);
  const farmerCtx = farmer?.profile_json
    ? JSON.stringify(JSON.parse(farmer.profile_json), null, 2)
    : "Not yet known.";

  const captionPart = captionEn
    ? `\n\n# Farmer's question about this photo\n${captionEn}`
    : "\n\nThe farmer sent no question with the photo. Diagnose what you can see.";

  const prompt = `You are Akrush, an agricultural helpline assistant for Indian farmers.
A farmer sent a photo (possibly of a crop, plant, leaf, pest, soil, or field).

# Farmer profile
${farmerCtx}${captionPart}

Analyze the image and reply in clear, simple English (the reply will be translated to the farmer's language):
1. What you see / likely problem (disease, pest, deficiency, etc.)
2. What to do next (practical steps)
3. Always advise confirming pesticide/medicine dosage with the local KVK or agriculture officer
Keep it short (WhatsApp-friendly). If the image is unclear or not crop-related, say so honestly.`;

  saveMessage({
    chat_id: chatId,
    role: "user",
    content: captionEn ? `[photo] ${captionEn}` : "[photo]",
    tool_call_id: null,
    tool_name: null,
  });

  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: imageBase64 } },
        ] as Part[],
      },
    ],
  });

  const text = response.text || "";
  saveMessage({ chat_id: chatId, role: "assistant", content: text, tool_call_id: null, tool_name: null });
  return { text };
}
