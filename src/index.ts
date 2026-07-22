import { type Server } from "node:http";
import express from "express";
import morgan from "morgan";
import { router } from "@/routers/index";
import { errorHandler } from "@/middleware/error";
import { logger } from "@/logger";
import { env } from "@/env";
import { services } from "@/services/index";

const TERMINATION_GRACE_PERIOD_MS = 10_000;

const app = express();
app.use(morgan("tiny"));
app.use(express.json());

app.use(router);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(errorHandler);

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
    // HTTP is drained — release the service connections.
    await services.close();
  } catch (err) {
    logger.error("Error during shutdown", err);
  }

  clearTimeout(forceExitTimer);
  logger.info("Graceful shutdown complete");
  process.exit(0);
}

function start() {
  const server = app.listen(env.port, env.host, () => {
    logger.info(`Listening on port ${env.port}`);
  });

  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM", server));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT", server));
}

start();
