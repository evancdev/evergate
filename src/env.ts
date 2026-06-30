import "dotenv/config";

const port = Number(process.env.PORT) || 8765;

const neo4jPassword = process.env.NEO4J_PASSWORD;
if (!neo4jPassword) throw new Error("Missing NEO4J_PASSWORD");

/** Central config: reads process.env, with optional fallbacks. */
export const env = {
  port,
  allowedHosts: (
    process.env.MCP_ALLOWED_HOSTS ?? `127.0.0.1:${port},localhost:${port}`
  ).split(","),
  neo4j: {
    uri: process.env.NEO4J_URI ?? "bolt://localhost:7687",
    user: process.env.NEO4J_USER ?? "neo4j",
    password: neo4jPassword,
  },
};
