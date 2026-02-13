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
    } else if (path === "/api/debug") {
      // Debug endpoint to check git notes
      const { execFileSync } = require("child_process");
      const { getCommitsWithTraces, readTracesFromNotes } = require("../lib/git-notes.js");
      const { getWorkspaceRoot } = require("../lib/trace-store.js");
      
      const root = getWorkspaceRoot();
      let debugInfo: any = {
        workspaceRoot: root,
        notesRef: "refs/notes/agent-trace",
      };
      
      try {
        // Check if notes ref exists
        execFileSync("git", ["show-ref", "--verify", "refs/notes/agent-trace"], {
          cwd: root,
          stdio: "pipe",
        });
        debugInfo.notesRefExists = true;
      } catch {
        debugInfo.notesRefExists = false;
      }
      
      try {
        const commits = getCommitsWithTraces(root);
        debugInfo.commitsWithTraces = commits.length;
        debugInfo.commitShas = commits;
        
        if (commits.length > 0) {
          const firstCommit = commits[0];
          const traces = readTracesFromNotes(firstCommit, root);
          debugInfo.firstCommitTraces = traces.length;
          debugInfo.firstCommitSha = firstCommit;
        }
      } catch (error: any) {
        debugInfo.error = error.message || String(error);
      }
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(debugInfo, null, 2));
    } else if (path === "/" || path === "/index.html") {
      // Serve dashboard HTML
      // Try multiple possible paths (for different installation scenarios)
      const possiblePaths = [
        join(__dirname, "public/index.html"), // Compiled location (dist/dashboard/public/index.html)
        join(__dirname, "../dashboard/public/index.html"), // Alternative compiled location
        join(__dirname, "../../src/dashboard/public/index.html"), // Source location (dev)
        join(process.cwd(), "node_modules/agent-trace-cli/dist/dashboard/public/index.html"), // Installed via npm
        join(process.cwd(), "node_modules/agent-trace-cli/src/dashboard/public/index.html"), // Installed source
      ];
      
      let htmlPath: string | undefined;
      for (const testPath of possiblePaths) {
        if (existsSync(testPath)) {
          htmlPath = testPath;
          break;
        }
      }
      
      if (htmlPath) {
        const html = readFileSync(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      } else {
        // Fallback: serve a simple HTML page with API info
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>Agent Trace Dashboard</title>
  <style>
    body { font-family: sans-serif; padding: 2rem; background: #0a0a0a; color: #e0e0e0; }
    h1 { color: #fff; }
    .endpoint { background: #1a1a1a; padding: 1rem; margin: 0.5rem 0; border-radius: 4px; }
    code { background: #2a2a2a; padding: 0.2rem 0.4rem; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Agent Trace Dashboard API</h1>
  <p>Dashboard HTML not found, but API endpoints are available:</p>
  <div class="endpoint">
    <strong>GET</strong> <code>/api/stats?from=&lt;commit&gt;&amp;to=&lt;commit&gt;</code>
    <p>Get aggregated statistics</p>
  </div>
  <div class="endpoint">
    <strong>GET</strong> <code>/api/commits/&lt;sha&gt;/traces</code>
    <p>Get traces for a specific commit</p>
  </div>
  <div class="endpoint">
    <strong>GET</strong> <code>/api/files/&lt;path&gt;/attribution</code>
    <p>Get file attribution</p>
  </div>
  <div class="endpoint">
    <strong>GET</strong> <code>/api/health</code>
    <p>Health check</p>
  </div>
  <p style="margin-top: 2rem; color: #888;">
    Note: The dashboard HTML file should be at: <code>src/dashboard/public/index.html</code>
  </p>
</body>
</html>
        `);
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

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${port} is already in use.`);
      console.error(`   Try: agent-trace dashboard --port <different-port>`);
      console.error(`   Or stop the process using port ${port}`);
      process.exit(1);
    } else {
      throw error;
    }
  });
}
