/**
 * A tiny, zero-dependency static file server for the fixture site.
 *
 * Fixture-first testing (Part 5 of the spec): every core test runs against
 * static HTML served locally. No network, no flakiness, no cost.
 */
import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(here, "site");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export interface FixtureServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Start the fixture server on an ephemeral port. Returns its base URL. */
export function startFixtureServer(port = 0): Promise<FixtureServer> {
  const server: Server = createServer(async (req, res) => {
    try {
      const rawPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");

      // Controllable status routes for testing non-2xx navigation, e.g.
      // /status/404 or /status/500. Serves a real HTML body with that status.
      const statusMatch = /^\/status\/(\d{3})$/.exec(rawPath);
      if (statusMatch) {
        const code = Number(statusMatch[1]);
        res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><title>${code}</title><h1>${code}</h1><p>status route</p>`);
        return;
      }

      const rel = rawPath === "/" ? "/index.html" : rawPath;
      // Prevent path traversal: resolve and confirm it stays under SITE_DIR.
      const filePath = path.join(SITE_DIR, rel);
      if (!filePath.startsWith(SITE_DIR)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      const body = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<h1>404</h1>");
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (addr == null || typeof addr === "string") {
        reject(new Error("failed to bind fixture server"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        close: () =>
          new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}

// Allow `tsx fixtures/server.ts` to run it standalone on a fixed port.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4599);
  startFixtureServer(port).then((s) => {
    // eslint-disable-next-line no-console
    console.log(`fixture site: ${s.url}`);
  });
}
