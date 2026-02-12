import { createServer, IncomingMessage, ServerResponse } from "http";
import { parse } from "url";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getDashboardStats, getCommitTraces, getFileAttribution } from "./api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const parsedUrl = parse(req.url || "/", true);
  const path = parsedUrl.pathname || "/";
  const query = parsedUrl.query || {};

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    if (path === "/api/stats") {
      const stats = await getDashboardStats(
        query.from as string | undefined,
        (query.to as string) || "HEAD"
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ...stats,
          totalFiles: stats.totalFiles.size,
          models: Object.fromEntries(stats.models),
          tools: Object.fromEntries(stats.tools),
        })
      );
    } else if (path.startsWith("/api/commits/") && path.endsWith("/traces")) {
      const commitSha = path.split("/")[3];
      const traces = getCommitTraces(commitSha);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(traces));
    } else if (path.startsWith("/api/files/") && path.endsWith("/attribution")) {
      const filePath = decodeURIComponent(path.split("/")[3]);
      const attribution = getFileAttribution(
        filePath,
        query.from as string | undefined,
        (query.to as string) || "HEAD"
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(attribution));
    } else if (path === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (path === "/" || path === "/index.html") {
      // Serve dashboard HTML
      const htmlPath = join(__dirname, "../dashboard/public/index.html");
      if (existsSync(htmlPath)) {
        const html = readFileSync(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Dashboard not found");
      }
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

export function startDashboardServer(port: number = PORT): void {
  const server = createServer(handleRequest);

  server.listen(port, () => {
    console.log(`Agent Trace Dashboard API running on http://localhost:${port}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET /api/stats?from=<commit>&to=<commit>`);
    console.log(`  GET /api/commits/<sha>/traces`);
    console.log(`  GET /api/files/<path>/attribution?from=<commit>&to=<commit>`);
    console.log(`  GET /api/health`);
  });
}
