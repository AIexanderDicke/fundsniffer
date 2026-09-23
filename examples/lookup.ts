import { createFundSnifferClient } from "../src/index.ts";

const isin = process.argv[2];
if (!isin) {
  console.error("Usage: node examples/lookup.ts <ISIN>");
  process.exit(1);
}

const client = createFundSnifferClient({ minDelayMs: 1000 });

const info = await client.getFund(isin);
if (!info) {
  console.error(`No fund or ETF found for ${isin}`);
  process.exit(2);
}

console.log(JSON.stringify(info, null, 2));
