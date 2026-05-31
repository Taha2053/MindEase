import http from "node:http";
import https from "node:https";

const PORT = 3001;
const NAPKIN_BASE = "api.napkin.ai";

const FORWARD_BLOCKLIST = new Set([
  "host", "connection", "keep-alive", "transfer-encoding", "origin",
]);

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname + url.search;

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!FORWARD_BLOCKLIST.has(k) && typeof v === "string") {
        headers[k] = v;
      }
    }
    headers.host = NAPKIN_BASE;

    const options = {
      hostname: NAPKIN_BASE,
      path: `/v1${path}`,
      method: req.method,
      headers,
    };

    const proxyReq = https.request(options, (proxyRes) => {
      const responseHeaders = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (k !== "transfer-encoding") {
          responseHeaders[k] = v;
        }
      }
      responseHeaders["access-control-allow-origin"] = "*";
      res.writeHead(proxyRes.statusCode ?? 200, responseHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("Proxy error:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      if (!res.destroyed) res.end(JSON.stringify({ error: err.message }));
    });

    req.pipe(proxyReq);
  })
  .listen(PORT, () => {
    console.log(`Napkin proxy running on http://localhost:${PORT}`);
    console.log(`Forwarding to ${NAPKIN_BASE}/v1/...`);
  });
