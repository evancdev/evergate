import { Router } from "express";
import { mcpRouter } from "./mcp.js";
import { hermesRouter } from "./hermes.js";

export const router = Router();
router.use("/mcp", mcpRouter);
router.use("/hermes", hermesRouter);
