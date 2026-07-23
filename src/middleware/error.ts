import type { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";
import { MissingIdentityError } from "@/errors";
import { logger } from "@/logger";

/** Central error handling. */
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (err instanceof ZodError) {
    const message = z.prettifyError(err);
    logger.warn(message);
    res.status(400).json({ description: message, errors: z.treeifyError(err) });
    return;
  }
  if (err instanceof MissingIdentityError) {
    logger.warn(err.message);
    res.status(400).json({ description: err.message });
    return;
  }
  logger.error("Unhandled error", err);
  res.status(500).json({ error: "An unexpected error occurred" });
};
