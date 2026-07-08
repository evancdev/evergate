import type { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";
import { MissingIdentityError } from "../errors.js";
import { logger } from "../logger.js";

/** Central error handling. */
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (err instanceof ZodError) {
    res
      .status(400)
      .json({ description: z.prettifyError(err), errors: z.treeifyError(err) });
    return;
  }
  if (err instanceof MissingIdentityError) {
    res.status(400).json({ description: err.message });
    return;
  }
  logger.error("Unhandled error", err);
  res.status(500).json({ error: "An unexpected error occurred" });
};
