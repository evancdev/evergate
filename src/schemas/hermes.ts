import { z } from "zod";

export const registerSessionSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1)
    .describe("One line on what you're working on"),
});

export interface Session {
  session_id: string;
  description: string;
  registered_at: string;
  last_seen: string;
}
