import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createFundSnifferClient } from "./client.ts";
import { isFundSnifferError } from "./errors.ts";

const PORT = Number(process.env.PORT ?? 8484);
const HOST = process.env.HOST ?? "0.0.0.0";
const MIN_DELAY_MS = Number(process.env.MIN_DELAY_MS ?? 1000);

const client = createFundSnifferClient({
  minDelayMs: MIN_DELAY_MS,
  cache: process.env.CACHE !== "false",
});

const FUND_ROUTE = /^\/fund\/([^/]+)\/?$/;

const ERROR_STATUS: Record<string, number> = {
  invalid: 400,
  not_found: 404,
  blocked: 503,
  timeout: 504,
  network: 502,
  parse: 502,
};

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(payload);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;

  if (pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  const match = FUND_ROUTE.exec(pathname);
  if (!match) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  let isin: string;
  try {
    isin = decodeURIComponent(match[1]);
  } catch {
    sendJson(res, 400, { error: "invalid", message: "Malformed ISIN" });
    return;
  }

  try {
    const fund = await client.getFund(isin);
    if (!fund) {
      sendJson(res, 404, { error: "not_found", message: `No fund or ETF found for ${isin}` });
      return;
    }
    sendJson(res, 200, fund);
  } catch (error) {
    if (isFundSnifferError(error)) {
      const status = ERROR_STATUS[error.code] ?? 502;
      const headers =
        error.code === "blocked" && error.retryAfterMs !== undefined
          ? { "retry-after": String(Math.ceil(error.retryAfterMs / 1000)) }
          : undefined;
      sendJson(res, status, { error: error.code, message: error.message }, headers);
      return;
    }
    sendJson(res, 500, { error: "internal", message: "Unexpected error" });
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) sendJson(res, 500, { error: "internal" });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`fundsniffer listening on http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
