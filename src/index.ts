import express from "express";
import { mcpRouter } from "./mcp.js";
import { logger } from "./logger.js";
import { env } from "./env.js";

const TERMINATION_GRACE_PERIOD_MS = 10_000;

const app = express();
app.use(express.json());

app.use("/mcp", mcpRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const server = app.listen(env.port, "::", () => {
  logger.info(`Listening on port ${env.port}`);
});

let isShuttingDown = false;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info("Beginning graceful shutdown", { signal });

  const forceExitTimer = setTimeout(() => {
    logger.error("Graceful shutdown timed out, forcing exit", undefined, {
      timeoutSeconds: TERMINATION_GRACE_PERIOD_MS / 1000,
    });
    process.exit(1);
  }, TERMINATION_GRACE_PERIOD_MS).unref();

  server.close((error) => {
    if (error && error.message !== "Server is not running.") {
      logger.error("Error while closing HTTP server", error);
    }

    clearTimeout(forceExitTimer);
    logger.info("Graceful shutdown complete");
    process.exit(0);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
