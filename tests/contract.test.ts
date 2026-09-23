import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toFundInfo } from "../src/normalize.ts";
import { parseFundPage, type ParsedFund } from "../src/parse/page.ts";
import type { FundInfo } from "../src/types.ts";
import { fixture } from "./support.ts";

const STRING_FIELDS = [
  "currency",
  "ter",
  "assetClass",
  "distribution",
  "benchmark",
  "dataAsOf",
  "wkn",
  "url",
  "issuer",
  "fundSize",
  "replication",
  "launchDate",
] as const;

const NUMBER_FIELDS = ["holdingsCount", "riskRating", "morningstarRating"] as const;

/**
 * The shape every `FundInfo` must satisfy regardless of which page layout it
 * came from. Required fields must be present and correctly typed; optional
 * fields may be missing but must not have the wrong type.
 */
function assertFundInfoContract(info: FundInfo): void {
  assert.equal(typeof info.isin, "string");
  assert.ok(info.isin.length > 0, "isin must not be empty");
  assert.equal(typeof info.name, "string");
  assert.ok(info.name.trim().length > 0, "name must not be empty");
  assert.equal(typeof info.source, "string");
  assert.equal(typeof info.stale, "boolean");

  assert.ok(Array.isArray(info.topHoldings), "topHoldings must be an array");
  for (const holding of info.topHoldings) {
    assert.equal(typeof holding.name, "string");
    assert.ok(Number.isFinite(holding.weight), "holding.weight must be a finite number");
    assert.ok(holding.weight >= 0 && holding.weight <= 100);
    if (holding.isin !== undefined) {
      assert.match(holding.isin, /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/);
    }
  }

  assert.equal(typeof info.coverage, "number");
  assert.ok(Number.isFinite(info.coverage));
  assert.ok(info.coverage >= 0 && info.coverage <= 1, "coverage must be 0..1");

  assert.ok(info.breakdowns, "breakdowns must be present");
  for (const entries of [info.breakdowns.sector, info.breakdowns.geography]) {
    assert.ok(Array.isArray(entries));
    for (const entry of entries) {
      assert.equal(typeof entry.label, "string");
      assert.ok(Number.isFinite(entry.weight));
      assert.ok(entry.weight >= 0 && entry.weight <= 100);
    }
  }

  if (info.assetAllocation !== undefined) {
    assert.ok(Array.isArray(info.assetAllocation));
  }

  for (const field of STRING_FIELDS) {
    const value = info[field];
    if (value !== undefined) assert.equal(typeof value, "string", `${field} must be a string`);
  }
  for (const field of NUMBER_FIELDS) {
    const value = info[field];
    if (value !== undefined) assert.ok(Number.isFinite(value), `${field} must be a number`);
  }
}

const EMPTY: ParsedFund = {
  name: "X",
  keyFacts: {},
  topHoldings: [],
  sectors: [],
  countries: [],
  instruments: [],
};

describe("FundInfo contract", () => {
  it("holds for the ETF layout and carries its published fields", () => {
    const parsed = parseFundPage(fixture("etf-ie00b4l5y983.html"));
    const info = toFundInfo(parsed, {
      isin: "IE00B4L5Y983",
      url: "https://www.finanzen.net/etf/ishares-core-msci-world-etf-ie00b4l5y983",
    });

    assertFundInfoContract(info);
    assert.equal(typeof info.currency, "string");
    assert.equal(typeof info.ter, "string");
    assert.equal(typeof info.benchmark, "string");
    assert.ok(info.topHoldings.length > 0);
    assert.ok(
      info.topHoldings.some((holding) => holding.isin !== undefined),
      "ETF top holdings expose ISINs",
    );
  });

  it("holds for the fund layout and carries its published fields", () => {
    const parsed = parseFundPage(fixture("fund-lu1437020735.html"));
    const info = toFundInfo(parsed, {
      isin: "LU1437020735",
      url: "https://www.finanzen.net/fonds/amundi-msci-world-climate-transition-lu1437020735",
    });

    assertFundInfoContract(info);
    assert.equal(typeof info.currency, "string");
    assert.equal(typeof info.ter, "string");
    assert.ok(info.topHoldings.length > 0);
    assert.ok(
      info.topHoldings.every((holding) => holding.isin === undefined),
      "fund top holdings have no ISINs",
    );
  });

  it("holds when the page publishes nothing optional", () => {
    assertFundInfoContract(toFundInfo(EMPTY, { isin: "IE00B4L5Y983" }));
  });
});
