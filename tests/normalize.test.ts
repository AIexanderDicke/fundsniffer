import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toFundInfo } from "../src/normalize.ts";
import { parseFundPage } from "../src/parse/page.ts";
import { fixture } from "./support.ts";

const URL = "https://www.finanzen.net/etf/ishares-core-msci-world-etf-ie00b4l5y983";

describe("toFundInfo", () => {
  const parsed = parseFundPage(fixture("etf-ie00b4l5y983.html"));

  it("maps the scraped page onto FundInfo", () => {
    const info = toFundInfo(parsed, { isin: "ie00b4l5y983", url: URL, wkn: "A0RPWH" });

    assert.equal(info.isin, "IE00B4L5Y983");
    assert.equal(info.name, "iShares Core MSCI World ETF");
    assert.equal(info.currency, "USD");
    assert.equal(info.ter, "0.20%");
    assert.equal(info.assetClass, "Aktien");
    assert.equal(info.distribution, "Thesaurierend");
    assert.equal(info.benchmark, "MSCI World");
    assert.equal(info.source, "finanzen.net");
    assert.equal(info.stale, false);
    assert.equal(info.url, URL);
    assert.equal(info.wkn, "A0RPWH");
    assert.equal(info.issuer, "BlackRock Asset Management - ETF");
    assert.equal(info.fundSize, "131.969.453.745,29");
    assert.equal(info.replication, "Physisch optimiert");
    assert.equal(info.launchDate, "25.09.2009");
    assert.equal(info.morningstarRating, 4);
  });

  it("computes coverage from the top holdings", () => {
    const info = toFundInfo(parsed, { isin: "IE00B4L5Y983" });
    assert.equal(info.topHoldings.length, 10);
    assert.ok(Math.abs(info.coverage - 0.274) < 1e-9, String(info.coverage));
  });

  it("exposes sector and country breakdowns plus asset allocation", () => {
    const info = toFundInfo(parsed, { isin: "IE00B4L5Y983" });
    assert.ok(info.breakdowns!.sector.some((entry) => entry.label === "Semiconductors"));
    assert.ok(info.breakdowns!.geography.some((entry) => entry.label === "United States"));
    assert.ok(info.assetAllocation!.some((entry) => entry.label === "Aktien"));
  });

  it("prefers the search hit name over the scraped heading", () => {
    const info = toFundInfo(parsed, {
      isin: "IE00B4L5Y983",
      name: "iShares Core MSCI World UCITS ETF USD (Acc)",
    });
    assert.equal(info.name, "iShares Core MSCI World UCITS ETF USD (Acc)");
  });

  it("falls back to the Währung label for funds", () => {
    const fund = parseFundPage(fixture("fund-lu1437020735.html"));
    const info = toFundInfo(fund, { isin: "LU1437020735" });
    assert.equal(info.currency, "EUR");
    assert.equal(info.ter, "0.15%");
    assert.equal(info.issuer, "Amundi Luxembourg S.A.");
    assert.equal(info.fundSize, "145,87 Mio. EUR");
    assert.equal(info.morningstarRating, 5);
  });

  it("marks the result stale when asked", () => {
    const info = toFundInfo(parsed, { isin: "IE00B4L5Y983", stale: true });
    assert.equal(info.stale, true);
  });

  it("leaves optional fields undefined when the page lacks them", () => {
    const info = toFundInfo(
      { name: "X", keyFacts: {}, topHoldings: [], sectors: [], countries: [], instruments: [] },
      { isin: "IE00B4L5Y983" },
    );
    assert.equal(info.currency, undefined);
    assert.equal(info.ter, undefined);
    assert.equal(info.assetAllocation, undefined);
    assert.equal(info.coverage, 0);
    assert.deepEqual(info.breakdowns, { sector: [], geography: [] });
  });
});
