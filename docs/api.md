# API reference

## `createFundSnifferClient(options?)`

```ts
import { createFundSnifferClient } from "fundsniffer";

const client = createFundSnifferClient({
  baseUrl: "https://www.finanzen.net", // default
  fetchImpl: fetch, // injectable for tests
  timeoutMs: 15_000, // per request
  userAgent: undefined, // browser-like default
  minDelayMs: 1000, // polite gap between requests, serialised across concurrency
  retries: 2, // retries for blocked / network / timeout
  retryBaseDelayMs: 500, // exponential backoff base, with jitter
  maxRetryDelayMs: 30_000, // cap for backoff / Retry-After waits
  random: Math.random, // jitter source, injectable for tests
  cache: false, // conditional-request caching; true = bounded in-memory
  sleep: undefined, // injectable for tests
});
```

Retryable failures (`blocked`, `network`, `timeout`) are retried with exponential backoff
plus jitter. A `Retry-After` header (seconds or HTTP date) takes precedence and is capped at
`maxRetryDelayMs`. HTTP 403 and 429 both map to `blocked`. Non-retryable errors (`invalid`,
`not_found`, `parse`) fail immediately.

Set `cache: true` to enable conditional requests (`If-None-Match` / `If-Modified-Since`) with a
bounded in-memory store. A `304` reuses the cached body; if a refresh fails, the last good body
is served with `stale: true` instead of throwing. Pass a custom `ResponseCache` for your own
storage, or leave it off (the default) to avoid retaining page bodies.

### `client.search(query, options?)`

Uses the site's search field (`/suggest/finde/jsonv2`).

```ts
const hits = await client.search("MSCI World", { maxResults: 10, includeAds: false });
// [{ isin: "IE00B4L5Y983", wkn: "A0RPWH", name: "…", url: "https://…", type: "ETFs" }, …]
```

Throws `FundSnifferError` on a blocked/non-OK response or an unparsable body.

### `client.findByIsin(isin)`

Resolves an ISIN to its instrument page. Tries the suggestion endpoint first; on a
`blocked` / `network` / `timeout` error it falls back to the `suchergebnis.asp` redirect.
Returns `null` for unknown or malformed identifiers.

### `client.getFund(isin)`

Resolves and scrapes an ISIN into a `FundInfo`.

- Returns `null` when there is no ETF/fund page for the ISIN.
- Throws `FundSnifferError` with `code: "invalid"` when the ISIN fails its check digit.
- Propagates `blocked` / `network` / `timeout` / `not_found` / `parse` errors otherwise.

### `client.getFundByUrl(url, options?)`

Scrapes an already-resolved page. `options.isin` overrides the ISIN recovered from the URL
slug; `options.wkn` / `options.name` are passed through to the result.

## Types

```ts
interface FundInfo {
  isin: string;
  name: string;
  currency?: string;
  ter?: string; // "0.20%"
  assetClass?: string; // "Aktien"
  distribution?: string; // "Thesaurierend" | "Ausschüttend"
  holdingsCount?: number; // not published by finanzen.net
  riskRating?: number; // not published by finanzen.net
  benchmark?: string;
  source: string; // "finanzen.net"
  stale: boolean; // true when served from cache after a failed refresh
  dataAsOf?: string; // not published by finanzen.net
  topHoldings: Holding[];
  coverage: number; // 0..1
  breakdowns?: { sector: BreakdownEntry[]; geography: BreakdownEntry[] };

  // finanzen.net extras
  wkn?: string;
  url?: string;
  issuer?: string;
  fundSize?: string;
  replication?: string;
  launchDate?: string;
  morningstarRating?: number; // 0..5
  assetAllocation?: BreakdownEntry[];
}

interface Holding {
  name: string;
  isin?: string; // ETFs only
  ticker?: string; // not published
  weight: number; // percent, 0..100
}

interface BreakdownEntry {
  label: string;
  weight: number; // percent, 0..100
}

interface SearchResult {
  isin?: string;
  wkn?: string;
  name: string;
  url: string;
  type: string; // group label, e.g. "ETFs", "Fonds", "Anzeige"
}
```

## Errors

```ts
class FundSnifferError extends Error {
  code: "invalid" | "blocked" | "not_found" | "timeout" | "network" | "parse";
  status?: number;
  retryAfterMs?: number; // from a Retry-After header, when present
}
```

| code        | Meaning                                                  |
| ----------- | -------------------------------------------------------- |
| `invalid`   | Input is not a valid ISIN (check digit failed).          |
| `blocked`   | HTTP 403/429 from Akamai — slow down / retry later.      |
| `not_found` | The resolved page returned 404.                          |
| `timeout`   | The request exceeded `timeoutMs`.                        |
| `network`   | Connection failure or an unexpected non-OK HTTP status.  |
| `parse`     | A response could not be parsed (JSON or page structure). |

## Pure helpers (exported for reuse / testing)

- `isValidIsin(value)`, `hasIsinShape(value)`, `normalizeIsin(value)`
- `parseFundPage(html): ParsedFund`
- `toFundInfo(parsed, options): FundInfo`
- `parsePercent("5,62 %") => 5.62`, `normalizePercentString("0,20 %") => "0.20%"`
- `parseChartSrc(src)`, `extractChartFromHtml(html)`
- `buildSuggestUrl(baseUrl, query, maxResults)`, `parseSuggestResults(json, baseUrl)`, `isAd(hit)`
- `extractIsinFromUrl(url)`
- `createMemoryCache(limit?)`, `parseRetryAfter(header)`, `HttpClient`

## HTTP backend

`src/server.ts` (also `npm start` / the Docker image) wraps `client.getFund` in a tiny
`node:http` server. Start it with `node src/server.ts`; config via `PORT` (8484),
`HOST` (0.0.0.0), `MIN_DELAY_MS` (1000) and `CACHE` (on unless `"false"`).

```http
GET /fund/:isin   -> 200 FundInfo JSON
GET /health       -> 200 {"status":"ok"}
```

Errors are returned as JSON `{ "error": <code>, "message": "..." }`:

| status | when                                                       |
| ------ | ---------------------------------------------------------- |
| 400    | `invalid` — malformed ISIN.                                |
| 404    | unknown route, or `not_found` — no ETF/fund for the ISIN.  |
| 502    | `network` / `parse`.                                       |
| 503    | `blocked` — includes `Retry-After` when the site sent one. |
| 504    | `timeout`.                                                 |
