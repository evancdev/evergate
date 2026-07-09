import { Router, type Request, type Response } from "express";
import { services } from "@/services/index";

const registerSession = (req: Request, res: Response) => {
  services.hermes.register(req.headers);
  res.status(204).end();
};

const deregisterSession = (req: Request, res: Response) => {
  services.hermes.deregister(req.headers);
  res.status(204).end();
};

export const hermesRouter = Router();
hermesRouter.post("/register", registerSession);
hermesRouter.post("/deregister", deregisterSession);
