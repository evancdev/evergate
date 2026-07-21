import { Router, type Request, type Response } from "express";
import { type z } from "zod";
import { services } from "@/services/index";
import { validate } from "@/middleware/validate";
import { setStatusSchema } from "@/schemas/hermes";

/** Add or refresh the caller in the roster. */
const registerSession = (req: Request, res: Response) => {
  services.hermes.register(req.headers);
  res.status(204).end();
};

/** Remove the caller from the roster. */
const deregisterSession = (req: Request, res: Response) => {
  services.hermes.deregister(req.headers);
  res.status(204).end();
};

/** Drain and return the caller's inbox. */
const checkMessages = (req: Request, res: Response) => {
  res.json(services.hermes.checkMessages(req.headers));
};

/** Drain and return the caller's inbox, but only while it's idle. */
const pullMessages = (req: Request, res: Response) => {
  res.json(services.hermes.pullIfIdle(req.headers));
};

/** Set the caller's status to busy or idle. */
const setStatus = (
  req: Request<unknown, unknown, z.infer<typeof setStatusSchema>>,
  res: Response,
) => {
  services.hermes.setStatus(req.body, req.headers);
  res.status(204).end();
};

export const hermesRouter = Router();
hermesRouter.post("/register", registerSession);
hermesRouter.post("/deregister", deregisterSession);
hermesRouter.post("/check", checkMessages);
hermesRouter.post("/pull", pullMessages);
hermesRouter.post("/status", validate(setStatusSchema), setStatus);
