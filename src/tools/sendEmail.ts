import nodemailer from "nodemailer";
import { config } from "../config.js";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: config.email.user, pass: config.email.pass },
});

export interface SendEmailArgs {
  to: string;
  subject: string;
  body?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<string> {
  if (!args.to || !args.subject) {
    return "ERROR: 'to' and 'subject' are required.";
  }

  const info = await transporter.sendMail({
    from: `"${config.email.fromName}" <${config.email.fromAddress}>`,
    to: args.to,
    subject: args.subject,
    text: args.body || "",
  });

  return `Email sent to ${args.to}. MessageId: ${info.messageId}`;
}

export const sendEmailSchema = {
  type: "object" as const,
  properties: {
    to: { type: "string", description: "Recipient email address" },
    subject: { type: "string", description: "Email subject line" },
    body: { type: "string", description: "Plain-text email body" },
  },
  required: ["to", "subject"],
};