import type { RequestHandler } from "express";
import { services } from "@/services/index";
import { requireTerminalId } from "@/lib";

/** Attach the caller's terminal id to the request; rejects a caller that sends none. */
export const attachTerminalId: RequestHandler = (req, _res, next) => {
  try {
    req.terminalId = requireTerminalId(req.headers);
    next();
  } catch (err) {
    next(err);
  }
};

/** Resolve the caller's live session id onto the request. Runs after attachTerminalId. */
export const requireSessionId: RequestHandler = (req, _res, next) => {
  try {
    req.sessionId = services.hermes.resolveSession(req.terminalId);
    next();
  } catch (err) {
    next(err);
  }
};
