import { Router } from "express";
import { mcpRouter } from "@/routers/mcp";
import { hermesRouter } from "@/routers/hermes";

export const router = Router();
router.use("/mcp", mcpRouter);
router.use("/hermes", hermesRouter);
