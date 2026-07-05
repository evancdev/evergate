import { z } from "zod";

export const upsertSchema = z.object({
  name: z.string().min(1).describe("Name identifying the entity"),
  type: z.string().min(1).optional().describe("Short lowercase category"),
  summary: z
    .string()
    .min(1)
    .optional()
    .describe("What the entity is, in one or two sentences"),
});

export const entitySchema = upsertSchema.extend({
  updated_at: z.string().datetime(),
});

export const searchSchema = z.object({
  query: z.string().min(1).optional().describe("Text to match against name"),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(10)
    .describe("Maximum number of entities to return"),
});

export const listSchema = z.object({
  type: z
    .string()
    .min(1)
    .optional()
    .describe("A type to list the entities of; omit to list all types instead"),
});
