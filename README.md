# fundsniffer

A thin, dependency-free wrapper around the [finanzen.net](https://www.finanzen.net/) search
for looking up funds and ETFs by ISIN.

## CLI example

```bash
node examples/lookup.ts IE00B4L5Y983
```

## Requirements

- Node.js >= 22.18
- No runtime dependencies. Dev-only: `typescript`, `@types/node`, `biome`, `prettier`.

## Usage

```ts
import { createFundSnifferClient } from "fundsniffer";

const client = createFundSnifferClient({ minDelayMs: 1000 });

const hits = await client.search("MSCI World"); // search field
const fund = await client.getFund("IE00B4L5Y983"); // scrape a page into FundInfo
```

