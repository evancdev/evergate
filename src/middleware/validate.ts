import type { RequestHandler } from "express";
import type { ZodType, z } from "zod";

/** Validate req.body against the schema; on failure forward the ZodError to the error handler. */
export function validate<S extends ZodType>(
  schema: S,
): RequestHandler<unknown, unknown, z.infer<S>, unknown> {
  return (req, _res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}
