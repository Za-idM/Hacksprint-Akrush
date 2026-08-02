import Groq from "groq-sdk";
import {
  type ChatCompletionMessageParam,
  type ChatCompletionTool,
} from "groq-sdk/resources/chat/completions";
import { config } from "./config.js";
import { loadProfile } from "./memory/profile.js";
import { getHistory, saveMessage } from "./memory/db.js";
import { TOOLS, dispatchTool, type ToolContext } from "./tools/registry.js";

const groq = new Groq({ apiKey: config.groqApiKey });
const toolsSchemas = TOOLS.map((t) => t.schema) as ChatCompletionTool[];

const systemPromptBase = loadProfile();

function buildSystemPrompt(): string {
  const now = new Date().toISOString();
  return `${systemPromptBase}

# Current UTC time
${now}

# Tool use rules
- Use the send_email tool when I ask you to email someone.
- Use the set_reminder tool when I ask you to remind me of something.
  Prefer "cron" for recurring reminders (5-field Unix cron). For one-shot, set "fireAt" (epoch ms).
- Always confirm before performing irreversible side-effects unless I clearly say "go ahead" / "now".
- Be concise.`;
}

export interface AgentReply {
  text: string;
}

export async function runAgent(
  chatId: string,
  userText: string
): Promise<AgentReply> {
  const ctx: ToolContext = { chatId };

  saveMessage({ chat_id: chatId, role: "user", content: userText, tool_call_id: null, tool_name: null });
  const history = getHistory(chatId, config.historyLimit);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
    ...history.map((m) => ({
      role: m.role,
      content: m.content,
      name: m.tool_name ?? undefined,
      tool_call_id: m.tool_call_id ?? undefined,
    }) as ChatCompletionMessageParam),
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 4;

  while (iterations++ < MAX_ITERATIONS) {
    const completion = await groq.chat.completions.create({
      model: config.groqModel,
      messages,
      tools: toolsSchemas,
      tool_choice: "auto",
      temperature: 0.6,
      max_tokens: 1024,
    });

    const choice = completion.choices[0];
    const msg = choice.message;
    messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        const args = JSON.parse(call.function.arguments || "{}");
        const result = await dispatchTool(call.function.name, args, ctx);
        saveMessage({ chat_id: chatId, role: "tool", content: result, tool_call_id: call.id, tool_name: call.function.name });
        messages.push({
          role: "tool",
          content: result,
          tool_call_id: call.id,
        } as ChatCompletionMessageParam);
      }
      continue;
    }

    const text = msg.content || "";
    saveMessage({ chat_id: chatId, role: "assistant", content: text, tool_call_id: null, tool_name: null });
    return { text };
  }

  const fallback = "Sorry, I got stuck in a tool loop. Try rephrasing?";
  saveMessage({ chat_id: chatId, role: "assistant", content: fallback, tool_call_id: null, tool_name: null });
  return { text: fallback };
}