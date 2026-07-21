import type { RequestHandler } from "express";
import { getSessionId } from "@/lib";

/** Resolve the caller's session id from X-Hermes-Agent onto `req.sessionId`; rejects if absent. */
export const requireSession: RequestHandler = (req, _res, next) => {
  try {
    req.sessionId = getSessionId(req.headers);
    next();
  } catch (err) {
    next(err);
  }
};
