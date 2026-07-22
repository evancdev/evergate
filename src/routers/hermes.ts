import { Router, type Request, type Response } from "express";
import { type z } from "zod";
import { services } from "@/services/index";
import { validate } from "@/middleware/validate";
import { attachTerminalId, requireSessionId } from "@/middleware/session";
import { setSessionSchema, setStatusSchema } from "@/schemas/hermes";

/** Set the terminal's session id. */
const setSession = (
  req: Request<unknown, unknown, z.infer<typeof setSessionSchema>>,
  res: Response,
) => {
  services.hermes.setSession(req.terminalId, req.body.session_id);
  res.status(204).end();
};

/** Add or refresh the caller's terminal in the roster. */
const registerSession = (req: Request, res: Response) => {
  services.hermes.register(req.terminalId);
  res.status(204).end();
};

/** Remove the caller's terminal from the roster. */
const deregisterSession = (req: Request, res: Response) => {
  services.hermes.deregister(req.terminalId);
  res.status(204).end();
};

/** Drain and return the caller's inbox. */
const checkMessages = (req: Request, res: Response) => {
  res.json(services.hermes.checkMessages(req.sessionId));
};

/** Drain and return the caller's inbox, but only while it's idle. */
const pullMessages = (req: Request, res: Response) => {
  res.json(services.hermes.pullIfIdle(req.sessionId));
};

/** Set the caller's status to busy or idle. */
const setStatus = (
  req: Request<unknown, unknown, z.infer<typeof setStatusSchema>>,
  res: Response,
) => {
  services.hermes.setStatus(req.body, req.terminalId);
  res.status(204).end();
};

export const hermesRouter = Router();
hermesRouter.use(attachTerminalId);
hermesRouter.post("/session", validate(setSessionSchema), setSession);
hermesRouter.post("/register", registerSession);
hermesRouter.post("/deregister", deregisterSession);
hermesRouter.post("/check", requireSessionId, checkMessages);
hermesRouter.post("/pull", requireSessionId, pullMessages);
hermesRouter.post("/status", validate(setStatusSchema), setStatus);
