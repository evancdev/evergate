import { z } from "zod";

export const updateSessionSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1)
    .describe("One line on what you're working on"),
});

export const sendMessageSchema = z.object({
  to: z.string().trim().min(1).describe("Recipient session id"),
  message: z.string().trim().min(1),
});

const sessionSummarySchema = z.object({
  session_id: z.string(),
  description: z.string(),
  last_seen: z.string().describe("How long ago the session checked in"),
});

const messageSchema = z.object({
  from: z.string().describe("The sender's session id"),
  message: z.string(),
  at: z.string().describe("How long ago it was sent"),
});

export const listSessionsOutputSchema = {
  sessions: z.array(sessionSummarySchema),
  messages: z.array(messageSchema).describe("Messages waiting for you"),
};

export const checkMessagesOutputSchema = {
  messages: z.array(messageSchema),
};
