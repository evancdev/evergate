import { Router, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { env } from "@/env";
import { registerTools } from "@/tools/index";

/** Handle one request: a fresh server + transport per call */
const handlePost = async (req: Request, res: Response) => {
  const server = new McpServer({ name: "evergate", version: "0.0.0" });
  registerTools(server);
  const transport = new StreamableHTTPServerTransport({
    // Stateless. Set a generator only if the server has to push to the client
    sessionIdGenerator: undefined,
    // Defense-in-depth against DNS rebinding (CVE-2025-66414)
    enableDnsRebindingProtection: true,
    allowedHosts: env.allowedHosts,
  });

  // Tear both down once the response is sent
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
};

export const mcpRouter = Router();
mcpRouter.post("/", handlePost);
