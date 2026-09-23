import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSuggestUrl, isAd, parseSuggestResults } from "../src/search.ts";
import { fixtureJson } from "./support.ts";

const BASE = "https://www.finanzen.net";

describe("buildSuggestUrl", () => {
  it("encodes the query and parameters", () => {
    const url = new URL(buildSuggestUrl(BASE, "MSCI World & Co", 7));
    assert.equal(url.pathname, "/suggest/finde/jsonv2");
    assert.equal(url.searchParams.get("max_results"), "7");
    assert.equal(url.searchParams.get("Keywords"), "MSCI World & Co");
    assert.equal(url.searchParams.get("query"), "MSCI World & Co");
    assert.equal(url.searchParams.get("Keywords_mode"), "APPROX");
    assert.equal(url.searchParams.get("bias"), "100");
  });
});

describe("parseSuggestResults", () => {
  const payload = fixtureJson("suggest-isin.json");

  it("flattens groups into hits and keeps ads tagged", () => {
    const results = parseSuggestResults(payload, BASE);
    assert.equal(results.length, 8);

    const etf = results.find((result) => result.type === "ETFs");
    assert.ok(etf);
    assert.equal(etf.isin, "IE00B4L5Y983");
    assert.equal(etf.wkn, "A0RPWH");
    assert.equal(etf.name, "iShares Core MSCI World UCITS ETF USD (Acc)");
    assert.equal(etf.url, "https://www.finanzen.net/etf/ishares-core-msci-world-etf-ie00b4l5y983");

    const ads = results.filter(isAd);
    assert.equal(ads.length, 2);
    for (const ad of ads) {
      assert.doesNotMatch(ad.name, /</);
      assert.equal(ad.isin, undefined);
    }
  });

  it("keeps multiple instrument groups from a name query", () => {
    const results = parseSuggestResults(fixtureJson("suggest-query.json"), BASE);
    const types = new Set(results.map((result) => result.type));
    for (const expected of ["ETFs", "Fonds", "Aktien", "Zertifikate", "Indizes"]) {
      assert.ok(types.has(expected), expected);
    }
    assert.ok(results.some((result) => result.isin === "LU1437020735"));
  });

  it("resolves relative URLs against the base", () => {
    const results = parseSuggestResults(
      { it: [{ n: "ETFs", il: [{ isin: "IE00B4L5Y983", n: "X", u: "/etf/x-ie00b4l5y983" }] }] },
      BASE,
    );
    assert.equal(results[0]?.url, "https://www.finanzen.net/etf/x-ie00b4l5y983");
  });

  it("survives malformed payloads", () => {
    assert.deepEqual(parseSuggestResults(null, BASE), []);
    assert.deepEqual(parseSuggestResults({ it: "nope" }, BASE), []);
    assert.deepEqual(parseSuggestResults({ it: [{ n: "ETFs", il: [{}] }] }, BASE), []);
  });
});
