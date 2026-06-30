import "dotenv/config";

const port = Number(process.env.PORT) || 8765;

/** Central config: reads process.env, with optional fallbacks. */
export const env = {
  port,
  allowedHosts: (
    process.env.MCP_ALLOWED_HOSTS ?? `127.0.0.1:${port},localhost:${port}`
  ).split(","),
};
