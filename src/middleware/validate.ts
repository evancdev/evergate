import type { RequestHandler } from "express";
import type { ZodType, z } from "zod";

type RequestLocation = "body" | "headers";

/** Validate the given part of the request against the schema; forward the ZodError to the error handler on failure. */
export function validate<S extends ZodType>(
  schema: S,
  loc?: "body",
): RequestHandler<unknown, unknown, z.infer<S>, unknown>;
export function validate<S extends ZodType>(
  schema: S,
  loc: "headers",
): RequestHandler;
export function validate<S extends ZodType>(
  schema: S,
  loc: RequestLocation = "body",
): RequestHandler {
  return (req, _res, next) => {
    try {
      (req as unknown as Record<string, unknown>)[loc] = schema.parse(
        req[loc] as unknown,
      );
      next();
    } catch (err) {
      next(err);
    }
  };
}
