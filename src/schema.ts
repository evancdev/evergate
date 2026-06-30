import { z } from "zod";

export const upsertSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Name identifying the entity."),
  type: z
    .string()
    .min(1)
    .optional()
    .describe("Short lowercase category"),
  summary: z
    .string()
    .min(1)
    .optional()
    .describe("One or two sentences on what the entity is."),
});
