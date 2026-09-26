# Reverse-engineering notes

Observed on 2026-09-23 by poking the live site. This is the "why" behind the scraper.

## Search

The header search box is backed by a JSON suggestion endpoint:

```
GET https://www.finanzen.net/suggest/finde/jsonv2
      ?max_results=10&Keywords_mode=APPROX&Keywords=<query>&query=<query>&bias=100
```

Groups (`n`) seen: `Anzeige` (ads), `Indizes`, `ETFs`, `Zertifikate`, `Fonds`, `Aktien`,
`Devisen`. Ads have `isin`/`wkn` `null` and HTML in `n`; the wrapper strips tags and tags them
with `type: "Anzeige"`.

## Resolving an ISIN

Fallback when suggestions are blocked:
`GET /suchergebnis.asp?strSuchString=<isin>&strKat=ETFs` redirects (302) to the canonical page.
Instrument URLs: `/etf/<slug>-<isin>`, `/fonds/<slug>-<isin>`, `/aktien/<slug>-aktie`,
`/index/<slug>`. The ISIN is always the trailing 12 characters of the slug.

## Page layouts

Two layouts share the same key-facts rows and pie charts but differ in markup:

- **ETF** (`/etf/...`): key facts in `#EtfBaseDataContent`; top holdings in `#TopHoldings`
  (with ISINs); all four charts in an inline `chartUrls` JS object.
- **Fund** (`/fonds/...`): key facts in the first table; charts each in
  `#PieChartAllocationTypeX-content`; no ISIN holdings table, so fund top holdings have no
  ISINs (names/weights come from the `H` chart).

Chart data lives in the image query string, not the image:

```
https://c.finanzen.net/chart.aspx?...&labels=Semiconductors%3BHardware&values=14.064;8.8275
```

`;` separates entries, `+` is a space, labels are percent-encoded; values use `.` decimals.

## Bot protection (Akamai)

- No browser-like `User-Agent` gets `403` from `AkamaiGHost`.
- Even with one, the site intermittently returns `403 Access Denied`; all `403`/`429` map to
  `FundSnifferError` with `code: "blocked"`. Use `minDelayMs` (default `1000`) to stay polite.

## Field availability

| Field                                                        | finanzen.net | Notes                              |
| ------------------------------------------------------------ | ------------ | ---------------------------------- |
| `currency`, `ter`, `assetClass`, `distribution`, `benchmark` | yes          |                                    |
| `topHoldings`                                                | yes (top 10) | ETF has ISINs, funds do not        |
| `breakdowns.sector` / `.geography`                           | yes          | chart `I` / `C`                    |
| `holdingsCount`                                              | no           | not published                      |
| `riskRating`                                                 | no           | only a 0–5 Morningstar star rating |
| `dataAsOf`                                                   | no           | quote date only                    |

## Refreshing fixtures

When `npm run test:live` fails after a site change, re-capture the raw HTTP bodies:

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
BASE=https://www.finanzen.net

curl -s -A "$UA" -H "Accept-Language: de-DE,de;q=0.9" \
  "$BASE/suggest/finde/jsonv2?max_results=10&Keywords_mode=APPROX&Keywords=IE00B4L5Y983&query=IE00B4L5Y983&bias=100" \
  -o tests/fixtures/suggest-isin.json

curl -s -A "$UA" -H "Accept-Language: de-DE,de;q=0.9" \
  "$BASE/suggest/finde/jsonv2?max_results=10&Keywords_mode=APPROX&Keywords=msci%20world&query=msci%20world&bias=100" \
  -o tests/fixtures/suggest-query.json

curl -s -L -A "$UA" -H "Accept-Language: de-DE,de;q=0.9" \
  "$BASE/suchergebnis.asp?strSuchString=IE00B4L5Y983&strKat=ETFs" \
  -o tests/fixtures/etf-ie00b4l5y983.html
```

Then run `npm test` and adjust the assertions. Fixtures are excluded from Prettier/Biome on
purpose.
