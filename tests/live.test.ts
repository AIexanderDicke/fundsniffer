import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFundSnifferClient } from "../src/client.ts";

/**
 * Live smoke tests. These are the early-warning system for site changes:
 * if finanzen.net restructures its HTML or endpoints, these fail even though
 * the fixture-based tests still pass.
 *
 * They hit the real site, so they are skipped unless `FUNDSNIFFER_LIVE=1` is set:
 *
 *   npm run test:live
 */
const LIVE = process.env.FUNDSNIFFER_LIVE === "1";
const ISIN = "IE00B4L5Y983";

describe("live finanzen.net", { skip: !LIVE }, () => {
  const client = createFundSnifferClient({ minDelayMs: 1000 });

  it("searches for an ISIN", async () => {
    const results = await client.search(ISIN);
    assert.ok(results.some((result) => result.isin === ISIN));
  });

  it("scrapes a known ETF", async () => {
    const info = await client.getFund(ISIN);
    assert.ok(info, "expected a FundInfo");
    assert.equal(info.isin, ISIN);
    assert.match(info.name, /iShares/i);
    assert.equal(info.currency, "USD");
    assert.ok(info.ter);
    assert.ok(info.topHoldings.length >= 5, "expected at least five top holdings");
    assert.ok(info.topHoldings[0]!.weight > 0);
    assert.ok(info.coverage > 0 && info.coverage <= 1);
    assert.ok((info.breakdowns?.sector.length ?? 0) > 0, "expected sector breakdown");
    assert.ok((info.breakdowns?.geography.length ?? 0) > 0, "expected country breakdown");
  });
});
