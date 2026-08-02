import type { ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import { sendEmail, sendEmailSchema, type SendEmailArgs } from "./sendEmail.js";
import { setReminder, setReminderSchema, type SetReminderArgs } from "./setReminder.js";

export interface ToolContext {
  chatId: string;
}

export type ToolName = "send_email" | "set_reminder";

export interface ToolDefinition {
  name: ToolName;
  schema: ChatCompletionTool;
  run: (args: any, ctx: ToolContext) => string | Promise<string>;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "send_email",
    schema: {
      type: "function",
      function: { name: "send_email", description: "Send an email on behalf of the user.", parameters: sendEmailSchema },
    },
    run: (args: SendEmailArgs, _ctx) => sendEmail(args),
  },
  {
    name: "set_reminder",
    schema: {
      type: "function",
      function: { name: "set_reminder", description: "Schedule a reminder to be sent to the user later.", parameters: setReminderSchema },
    },
    run: (args: SetReminderArgs & { when: string }, ctx) => {
      if (!args.cron && !args.fireAt) {
        return "ERROR: please provide either a 'cron' expression or 'fireAt' epoch ms.";
      }
      return setReminder({ ...args, chatId: ctx.chatId });
    },
  },
];

export const TOOL_MAP: Record<ToolName, ToolDefinition> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t])
) as Record<ToolName, ToolDefinition>;

export async function dispatchTool(
  name: string,
  args: any,
  ctx: ToolContext
): Promise<string> {
  const tool = TOOL_MAP[name as ToolName];
  if (!tool) return `ERROR: unknown tool '${name}'.`;
  try {
    return await tool.run(args, ctx);
  } catch (e: any) {
    return `ERROR running ${name}: ${e?.message ?? String(e)}`;
  }
}