# AGENTS.md — fundsniffer

Project context for agents working on this package.

## What this is

A thin, dependency-free TypeScript wrapper around **finanzen.net** that looks up funds and
ETFs by ISIN and returns a normalized `FundInfo`.

It does two things:

1. **Search** — resolve an ISIN or name to an instrument page via the site's search field.
2. **Scrape** — parse an instrument page into fund metadata, top holdings and sector /
   country breakdowns.

## Documentation

- `docs/api.md` — public API reference (client methods, types, errors, pure helpers).
- `docs/reverse-engineering.md` — endpoints, selectors, page layouts, field availability and
  how to re-capture fixtures. Read it before changing `search.ts` or anything under `parse/`,
  and update it when the site or the scraper changes.

## Architecture

```
caller ──▶ createFundSnifferClient ──▶ HttpClient ──▶ finanzen.net
                                   │
             search.ts ────────────┤ (suggestion JSON)
             parse/page.ts ────────┤ (instrument HTML)
             parse/charts.ts ──────┘ (composition chart data URIs)
```

- `HttpClient` owns the browser-like headers, timeout, politeness delay and error mapping.
- Pure parsing (`parse/page.ts`, `parse/charts.ts`, `parse/html.ts`) is separated from IO so
  it is fully unit-testable against fixtures.
- `client.ts` wires resolution + scraping together; `normalize.ts` maps the scraped shape
  onto `FundInfo`.
- `server.ts` is a tiny dependency-free HTTP wrapper (`node:http`) so the package can run as a
  backend: `GET /fund/:isin` -> `FundInfo` JSON, plus `GET /health`. Config via `PORT`,
  `HOST`, `MIN_DELAY_MS`, `CACHE`.

## Docker

`Dockerfile` (node:24-alpine, no build step, runs `src/server.ts` directly) and
`docker-compose.yml` expose the server on port 8484. The runtime strips the unused npm /
corepack / yarn tooling and the apk cache, then flattens the result into a `scratch` stage so
the deletions actually shrink the image (a `RUN rm` on top of the base only adds a whiteout).

```bash
docker build -t fundsniffer:latest .
docker compose up --build
curl localhost:8484/fund/IE00B4L5Y983
```

## Project layout

```
src/
  index.ts        public exports
  client.ts       createFundSnifferClient + ISIN resolution flow
  http.ts         HttpClient (headers, timeout, throttle, error mapping)
  search.ts       suggestion endpoint URL + response parsing
  normalize.ts    ParsedFund -> FundInfo
  isin.ts         structural + check-digit ISIN validation
  errors.ts       FundSnifferError + codes
  types.ts        FundInfo / Holding / Breakdown / SearchResult
  server.ts       HTTP backend (node:http): GET /fund/:isin, GET /health
  parse/
    html.ts       tiny dependency-free HTML parser + DOM helpers
    page.ts       instrument page -> ParsedFund (key facts, holdings, charts)
    charts.ts     composition chart image URLs -> label/value pairs
tests/
  fixtures/       captured HTTP bodies (HTML + JSON), excluded from formatters
  support.ts      fixture loader + routed fake fetch
  *.test.ts       node:test suites
docs/
  reverse-engineering.md site notes (endpoints, selectors, fixtures)
  api.md          public API reference
README.md         quick start / usage
examples/
  lookup.ts       CLI: node examples/lookup.ts <ISIN>
```

## Scripts

```bash
npm start              # run the HTTP backend: node src/server.ts
npm test               # fixture tests via node --test (type stripping, no build)
npm run test:coverage  # tests + built-in coverage report
npm run test:live      # real network smoke test, gated by FUNDSNIFFER_LIVE=1
npm run typecheck      # tsc --noEmit
npm run type-check     # alias for typecheck
npm run lint           # biome lint
npm run lint:fix       # biome lint --write
npm run format         # prettier --write
npm run format:check   # prettier --check
npm run check          # typecheck + tests
```

Always run `npm run typecheck`, `npm run lint` and `npm test` before considering work done.

## Key design decisions & gotchas

- **No runtime dependencies.** Node >= 22.18 runs the TypeScript directly, so there is no
  build step. `package.json` points `exports` at `src/index.ts`.
- **Fixture tests pin the page structure; live tests detect drift.** When finanzen.net
  changes, `npm run test:live` fails first. Re-capture the fixtures and update assertions —
  see `docs/reverse-engineering.md`.
- **Two page layouts.** ETFs put all composition charts in an inline `chartUrls` JSON object;
  funds render each chart in a `#PieChartAllocationTypeX-content` div. `parse/page.ts`
  supports both (JSON first, divs as fallback).
- **Chart data lives in image URLs**, not the images: `labels=...;...&values=...;...`.
- **Top holdings differ by layout.** ETFs have a `#TopHoldings` table with ISINs; funds only
  expose names/weights through the holdings chart (no ISINs). Documented, not a bug.
- **Akamai bot protection.** A browser-like `User-Agent` is required, and the site still
  returns intermittent `403`s. Those map to `FundSnifferError` with `code: "blocked"`; use
  `minDelayMs` to be polite.
- **Never assume the fields exist.** `holdingsCount`, `riskRating` and `dataAsOf` are not
  published; they stay `undefined`. Missing optional fields must not throw.
- **`parse/html.ts` is intentionally small.** It handles comments, void elements, quoted
  attributes and raw-text `<script>` / `<style>`; extend it with tests, not with a dependency.
- **Fixtures are excluded** from Prettier and Biome (`.prettierignore`, `biome.json`).

## Conventions

- Strict TypeScript, ESM only, explicit `.ts` extensions on relative imports.
- `noUnusedLocals` / `noUnusedParameters` are on.
- Tests use `node:test` + `node:assert/strict`; inject `fetchImpl` / `sleep`, never hit the
  network outside `tests/live.test.ts`.
- No comments unless they explain a non-obvious decision.
- Keep this file up to date: when you change the layout, scripts, design decisions or
  conventions, update `AGENTS.md` in the same change.
