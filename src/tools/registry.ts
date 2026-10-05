import { sendEmail, sendEmailSchema, type SendEmailArgs } from "./sendEmail.js";
import { setReminder, setReminderSchema, type SetReminderArgs } from "./setReminder.js";
import { mergeFarmerProfile } from "../memory/db.js";

export interface ToolContext {
  chatId: string;
}

export type ToolName = "send_email" | "set_reminder" | "update_farmer_profile";

export interface ToolDefinition {
  name: ToolName;
  declaration: FunctionDeclaration;
  run: (args: any, ctx: ToolContext) => string | Promise<string>;
}

export interface FunctionDeclaration {
  name: ToolName;
  description: string;
  parameters: Record<string, any>;
}

function toGeminiSchema(schema: Record<string, any>): Record<string, any> {
  const TYPE_MAP: Record<string, string> = {
    object: "OBJECT",
    string: "STRING",
    number: "NUMBER",
    integer: "NUMBER",
    boolean: "BOOLEAN",
    array: "ARRAY",
  };
  const convert = (s: any): any => {
    if (!s || typeof s !== "object") return s;
    const out: any = {};
    if (s.type) out.type = TYPE_MAP[s.type] ?? s.type;
    if (s.description) out.description = s.description;
    if (s.enum) out.enum = s.enum;
    if (s.properties) {
      out.properties = Object.fromEntries(
        Object.entries(s.properties).map(([k, v]) => [k, convert(v)])
      );
    }
    if (s.required) out.required = s.required;
    return out;
  };
  return convert(schema);
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "send_email",
    declaration: {
      name: "send_email",
      description: "Send an email on behalf of the user.",
      parameters: toGeminiSchema(sendEmailSchema),
    },
    run: (args: SendEmailArgs, _ctx) => sendEmail(args),
  },
  {
    name: "set_reminder",
    declaration: {
      name: "set_reminder",
      description:
        "Schedule a reminder to be sent to the farmer later. Use for crop-stage, irrigation, spray, and task reminders.",
      parameters: toGeminiSchema(setReminderSchema),
    },
    run: (args: SetReminderArgs, ctx) => {
      if (!args.cron && !args.fireAt) {
        return "ERROR: please provide either a 'cron' expression or 'fireAt' epoch ms.";
      }
      return setReminder({ ...args, chatId: ctx.chatId });
    },
  },
  {
    name: "update_farmer_profile",
    declaration: {
      name: "update_farmer_profile",
      description:
        "Save facts the farmer shares about themselves (village, district, crops grown, land size in acres, soil type, irrigation type, sowing season). Pass only the fields you learned, e.g. {\"crops\": \"cotton, soybean\"}.",
      parameters: {
        type: "OBJECT",
        description: "Key-value facts about the farmer.",
        properties: {
          fields: {
            type: "OBJECT",
            description:
              "Field names: village, district, state, crops, land_size_acres, soil_type, irrigation, sowing_season, name",
            properties: {},
          },
        },
        required: ["fields"],
      },
    },
    run: (args: { fields?: Record<string, string> }, ctx) => {
      if (!args.fields || Object.keys(args.fields).length === 0) {
        return "ERROR: provide at least one field to save.";
      }
      const merged = mergeFarmerProfile(ctx.chatId, args.fields);
      return `Farmer profile saved: ${merged}`;
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
