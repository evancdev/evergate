import { z } from "zod";

export const registerSessionSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1)
    .describe("One line on what you're working on"),
});

export const deregisterSchema = z.looseObject({
  "x-hermes-agent": z.string().trim().min(1),
});

export interface Session {
  session_id: string;
  description: string;
  registered_at: string;
  last_seen: string;
}

const sessionSummarySchema = z.object({
  session_id: z.string(),
  description: z.string(),
  last_seen: z.string().describe("how long ago the session checked in"),
});

export const listSessionsOutputSchema = {
  sessions: z.array(sessionSummarySchema),
};
