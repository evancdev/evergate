import { type Server } from "node:http";
import express from "express";
import { mcpRouter } from "./mcp.js";
import { closeDriver, ensureSchema } from "./graph.js";
import { logger } from "./logger.js";
import { env } from "./env.js";

const TERMINATION_GRACE_PERIOD_MS = 10_000;

const app = express();
app.use(express.json());

app.use("/mcp", mcpRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

let isShuttingDown = false;

async function gracefulShutdown(signal: string, server: Server) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info("Beginning graceful shutdown", { signal });

  const forceExitTimer = setTimeout(() => {
    logger.error("Graceful shutdown timed out, forcing exit", undefined, {
      timeoutSeconds: TERMINATION_GRACE_PERIOD_MS / 1000,
    });
    process.exit(1);
  }, TERMINATION_GRACE_PERIOD_MS).unref();

  try {
    // Stop accepting connections and wait for in-flight requests to drain.
    await new Promise<void>((resolve, reject) =>
      server.close((err) =>
        err && err.message !== "Server is not running."
          ? reject(err)
          : resolve(),
      ),
    );
    // HTTP is drained — release the Neo4j connection pool.
    await closeDriver();
  } catch (err) {
    logger.error("Error during shutdown", err as Error);
  }

  clearTimeout(forceExitTimer);
  logger.info("Graceful shutdown complete");
  process.exit(0);
}

async function start() {
  try {
    await ensureSchema();
    logger.info("Schema ready");
  } catch (err) {
    logger.error("Failed to ensure schema", err as Error);
    process.exit(1);
  }

  const server = app.listen(env.port, "::", () => {
    logger.info(`Listening on port ${env.port}`);
  });

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM", server));
  process.on("SIGINT", () => gracefulShutdown("SIGINT", server));
}

void start();
