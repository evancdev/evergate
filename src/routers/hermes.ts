import { Router, type Request, type Response } from "express";
import { type z } from "zod";
import { services } from "../services/index.js";
import { deregisterSchema } from "../schemas/hermes.js";
import { validate } from "../middleware/validate.js";

const deregisterSession = (
  req: Request<unknown, unknown, z.infer<typeof deregisterSchema>>,
  res: Response,
) => {
  services.hermes.deregister(req.body.session_id);
  res.status(204).end();
};

export const hermesRouter = Router();
hermesRouter.post("/deregister", validate(deregisterSchema), deregisterSession);
