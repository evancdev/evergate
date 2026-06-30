type LogData = Record<string, unknown>;

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

export const logger = {
  info(message: string, data?: LogData): void {
    console.info(message, data ?? "");
  },
  warn(message: string, data?: LogData): void {
    console.warn(message, data ?? "");
  },
  error(message: string, error?: unknown, data?: LogData): void {
    console.error(message, error ? formatError(error) : "", data ?? "");
  },
  debug(message: string, data?: LogData): void {
    if (process.env.NODE_ENV !== "production")
      console.info(message, data ?? "");
  },
  captureException(
    error: unknown,
    context?: { tags?: Record<string, string>; extra?: LogData },
  ): void {
    // TODO: wire to logging provider; for now log + format like error()
    console.error("Exception captured:", formatError(error), context ?? "");
  },
};
