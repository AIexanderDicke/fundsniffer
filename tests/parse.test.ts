import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFundSnifferError } from "../src/errors.ts";
import { normalizePercentString, parseFundPage, parsePercent } from "../src/parse/page.ts";
import { fixture } from "./support.ts";

describe("parseFundPage (ETF layout)", () => {
  const parsed = parseFundPage(fixture("etf-ie00b4l5y983.html"));

  it("reads the name and key facts", () => {
    assert.equal(parsed.name, "iShares Core MSCI World ETF");
    assert.equal(parsed.keyFacts["Total Expense Ratio (TER)"], "0,20 %");
    assert.equal(parsed.keyFacts["Fondswährung"], "USD");
    assert.equal(parsed.keyFacts["Kategorie"], "Aktien");
    assert.equal(parsed.keyFacts["Benchmark"], "MSCI World");
    assert.equal(parsed.keyFacts["Ausschüttungsart"], "Thesaurierend");
    assert.equal(parsed.keyFacts["Emittent"], "BlackRock Asset Management - ETF");
  });

  it("reads top holdings with ISINs", () => {
    assert.equal(parsed.topHoldings.length, 10);
    assert.deepEqual(parsed.topHoldings[0], {
      name: "NVIDIA Corp",
      isin: "US67066G1040",
      weight: 5.62,
    });
    assert.equal(parsed.topHoldings[1]?.name, "Apple Inc");
  });

  it("reads the composition charts", () => {
    assert.equal(parsed.sectors.find((entry) => entry.label === "Semiconductors")?.weight, 14.064);
    assert.equal(parsed.countries[0]?.label, "United States");
    assert.ok(parsed.countries[0]!.weight > 70);
    assert.equal(parsed.instruments.find((entry) => entry.label === "Aktien")?.weight, 99.6445);
  });

  it("counts the Morningstar stars", () => {
    assert.equal(parsed.morningstarRating, 4);
  });
});

describe("parseFundPage (distributing ETF)", () => {
  const parsed = parseFundPage(fixture("etf-ie00b0m62q58.html"));

  it("detects a distributing share class and a different TER", () => {
    assert.equal(parsed.keyFacts["Ausschüttungsart"], "Ausschüttend");
    assert.equal(parsed.keyFacts["Total Expense Ratio (TER)"], "0,50 %");
  });
});

describe("parseFundPage (fund layout)", () => {
  const parsed = parseFundPage(fixture("fund-lu1437020735.html"));

  it("reads the fund key facts", () => {
    assert.equal(parsed.name, "Amundi MSCI World Climate Transition - XE-C Fonds");
    assert.equal(parsed.keyFacts["Fondsgesellschaft"], "Amundi Luxembourg S.A.");
    assert.equal(parsed.keyFacts["Währung"], "EUR");
    assert.equal(parsed.keyFacts["Total Expense Ratio (TER)"], "0,15%");
    assert.equal(parsed.keyFacts["Ausschüttungsart"], "Thesaurierend");
  });

  it("derives top holdings from the chart (no ISINs on this layout)", () => {
    assert.equal(parsed.topHoldings[0]?.name, "Apple Inc");
    assert.equal(parsed.topHoldings[0]?.weight, 5.7318);
    assert.equal(parsed.topHoldings[0]?.isin, undefined);
    assert.ok(parsed.topHoldings.every((holding) => holding.name !== "Sonstige"));
  });

  it("reads the sectioned composition charts", () => {
    assert.ok(parsed.sectors.some((entry) => entry.label === "Semiconductors"));
    assert.ok(parsed.countries.some((entry) => entry.label === "United States"));
    assert.ok(parsed.instruments.some((entry) => entry.label === "Aktien"));
  });
});

describe("parseFundPage (layout anchor)", () => {
  it("throws a parse error when no known key-facts row is present", () => {
    const html = "<html><body><h1>Some other page</h1><table><tr><td>Foo</td><td>Bar</td></tr></table></body></html>";
    assert.throws(
      () => parseFundPage(html),
      (error: unknown) => isFundSnifferError(error) && error.code === "parse",
    );
  });

  it("accepts a page that only carries one anchor row", () => {
    const html = '<html><body><table><tr><td>Benchmark</td><td>MSCI World</td></tr></table></body></html>';
    assert.equal(parseFundPage(html).keyFacts.Benchmark, "MSCI World");
  });
});

describe("parsePercent", () => {
  it("parses German-formatted percentages", () => {
    assert.equal(parsePercent("5,62 %"), 5.62);
    assert.equal(parsePercent("0,20 %"), 0.2);
    assert.equal(parsePercent("131.969.453.745,29"), 131969453745.29);
  });

  it("returns null for placeholders and junk", () => {
    assert.equal(parsePercent("-"), null);
    assert.equal(parsePercent(""), null);
    assert.equal(parsePercent("n/a"), null);
  });
});

describe("normalizePercentString", () => {
  it("normalises to dot decimals with a percent sign", () => {
    assert.equal(normalizePercentString("0,20 %"), "0.20%");
    assert.equal(normalizePercentString("0,15%"), "0.15%");
  });

  it("returns undefined for empty or placeholder values", () => {
    assert.equal(normalizePercentString(""), undefined);
    assert.equal(normalizePercentString("-"), undefined);
  });
});
