import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFundSnifferClient, extractIsinFromUrl } from "../src/client.ts";
import { FundSnifferError } from "../src/errors.ts";
import { fixture, routedFetch, scriptedFetch } from "./support.ts";

const BASE = "https://www.finanzen.net";
const ETF_URL = `${BASE}/etf/ishares-core-msci-world-etf-ie00b4l5y983`;

const suggestFixture = fixture("suggest-isin.json");
const etfHtml = fixture("etf-ie00b4l5y983.html");

function clientWith(
  routes: Parameters<typeof routedFetch>[0],
  options: Record<string, unknown> = {},
) {
  const fetchImpl = routedFetch(routes);
  return {
    client: createFundSnifferClient({
      baseUrl: BASE,
      fetchImpl,
      sleep: async () => {},
      ...options,
    }),
    fetchImpl,
  };
}

describe("search", () => {
  it("returns instrument hits and drops ads by default", async () => {
    const { client } = clientWith([{ match: /suggest\/finde/, body: suggestFixture }]);
    const results = await client.search("IE00B4L5Y983");
    assert.equal(results.length, 6);
    assert.equal(results[0]?.isin, "IE00B4L5Y983");
  });

  it("keeps ads when asked", async () => {
    const { client } = clientWith([{ match: /suggest\/finde/, body: suggestFixture }]);
    const results = await client.search("IE00B4L5Y983", { includeAds: true });
    assert.equal(results.length, 8);
  });

  it("throws a parse error for a non-JSON body", async () => {
    const { client } = clientWith([{ match: /suggest\/finde/, body: "<html>nope" }]);
    await assert.rejects(client.search("x"), (error: unknown) => {
      assert.ok(error instanceof FundSnifferError);
      assert.equal(error.code, "parse");
      return true;
    });
  });

  it("maps HTTP 403 to a blocked error", async () => {
    const { client } = clientWith([{ match: /suggest\/finde/, status: 403 }]);
    await assert.rejects(client.search("x"), (error: unknown) => {
      assert.ok(error instanceof FundSnifferError);
      assert.equal(error.code, "blocked");
      assert.equal(error.status, 403);
      return true;
    });
  });
});

describe("findByIsin", () => {
  it("matches the exact ISIN from the suggestion endpoint", async () => {
    const { client } = clientWith([{ match: /suggest\/finde/, body: suggestFixture }]);
    const hit = await client.findByIsin("ie00b4l5y983");
    assert.equal(hit?.url, ETF_URL);
  });

  it("falls back to the search redirect when the suggestion endpoint is blocked", async () => {
    const { client, fetchImpl } = clientWith([
      { match: /suggest\/finde/, status: 403 },
      { match: /suchergebnis\.asp/, status: 302, headers: { location: `/etf/x-ie00b4l5y983` } },
      { match: /\/etf\//, body: etfHtml },
    ]);
    const hit = await client.findByIsin("IE00B4L5Y983");
    assert.equal(hit?.url, `${BASE}/etf/x-ie00b4l5y983`);
    assert.ok(
      (fetchImpl as unknown as { calls: string[] }).calls.some((url) =>
        url.includes("suchergebnis"),
      ),
    );
  });

  it("returns null for unknown identifiers", async () => {
    const { client } = clientWith([
      { match: /suggest\/finde/, body: JSON.stringify({ it: [] }) },
      { match: /suchergebnis\.asp/, body: "<html>search page</html>" },
    ]);
    assert.equal(await client.findByIsin("IE00B4L5Y983"), null);
  });

  it("returns null for malformed input without hitting the network", async () => {
    const { client, fetchImpl } = clientWith([]);
    assert.equal(await client.findByIsin("nope"), null);
    assert.equal((fetchImpl as unknown as { calls: string[] }).calls.length, 0);
  });
});

describe("getFund", () => {
  it("scrapes a fund into FundInfo", async () => {
    const { client } = clientWith([
      { match: /suggest\/finde/, body: suggestFixture },
      { match: /\/etf\//, body: etfHtml },
    ]);
    const info = await client.getFund("IE00B4L5Y983");
    assert.ok(info);
    assert.equal(info.isin, "IE00B4L5Y983");
    assert.equal(info.name, "iShares Core MSCI World UCITS ETF USD (Acc)");
    assert.equal(info.ter, "0.20%");
    assert.equal(info.wkn, "A0RPWH");
    assert.equal(info.url, ETF_URL);
    assert.equal(info.topHoldings.length, 10);
    assert.ok(info.breakdowns!.sector.length > 0);
  });

  it("rejects a malformed ISIN", async () => {
    const { client } = clientWith([]);
    await assert.rejects(client.getFund("NOT-AN-ISIN"), (error: unknown) => {
      assert.ok(error instanceof FundSnifferError);
      assert.equal(error.code, "invalid");
      return true;
    });
  });

  it("returns null when no fund page can be resolved", async () => {
    const { client } = clientWith([
      { match: /suggest\/finde/, body: JSON.stringify({ it: [] }) },
      { match: /suchergebnis\.asp/, body: "<html>search page</html>" },
    ]);
    assert.equal(await client.getFund("IE00B4L5Y983"), null);
  });

  it("returns null when the resolved hit is not a fund page", async () => {
    const { client } = clientWith([
      {
        match: /suggest\/finde/,
        body: JSON.stringify({
          it: [
            {
              n: "Aktien",
              il: [{ isin: "IE00B4L5Y983", n: "X", u: "/aktien/x-ie00b4l5y983" }],
            },
          ],
        }),
      },
    ]);
    assert.equal(await client.getFund("IE00B4L5Y983"), null);
  });
});

describe("getFundByUrl", () => {
  it("scrapes the given URL with an explicit ISIN", async () => {
    const { client } = clientWith([{ match: /\/etf\//, body: etfHtml }]);
    const info = await client.getFundByUrl(ETF_URL, { isin: "IE00B4L5Y983" });
    assert.equal(info.isin, "IE00B4L5Y983");
  });

  it("recovers the ISIN from the URL slug", async () => {
    const { client } = clientWith([
      { match: /\/fonds\//, body: fixture("fund-lu1437020735.html") },
    ]);
    const info = await client.getFundByUrl(
      `${BASE}/fonds/amundi-msci-world-climate-transition-xe-c-lu1437020735`,
    );
    assert.equal(info.isin, "LU1437020735");
    assert.equal(info.currency, "EUR");
  });

  it("throws not_found on a 404", async () => {
    const { client } = clientWith([{ match: /\/etf\//, status: 404 }]);
    await assert.rejects(
      client.getFundByUrl(ETF_URL, { isin: "IE00B4L5Y983" }),
      (error: unknown) => {
        assert.ok(error instanceof FundSnifferError);
        assert.equal(error.code, "not_found");
        return true;
      },
    );
  });

  it("throws parse when no ISIN can be determined", async () => {
    const { client } = clientWith([{ match: /\/etf\//, body: etfHtml }]);
    await assert.rejects(client.getFundByUrl(`${BASE}/etf/no-isin-here`), (error: unknown) => {
      assert.ok(error instanceof FundSnifferError);
      assert.equal(error.code, "parse");
      return true;
    });
  });
});

describe("stale cache", () => {
  it("marks a FundInfo stale when the page is served from cache after a failure", async () => {
    const fetchImpl = scriptedFetch([
      new Response(etfHtml, { status: 200 }),
      new Response(null, { status: 403 }),
    ]);
    const client = createFundSnifferClient({
      baseUrl: BASE,
      fetchImpl,
      cache: true,
      retries: 0,
      minDelayMs: 0,
      sleep: async () => {},
    });

    const fresh = await client.getFundByUrl(ETF_URL, { isin: "IE00B4L5Y983" });
    const stale = await client.getFundByUrl(ETF_URL, { isin: "IE00B4L5Y983" });

    assert.equal(fresh.stale, false);
    assert.equal(stale.stale, true);
    assert.equal(stale.name, fresh.name);
  });
});

describe("http error mapping", () => {
  it("maps a rejected fetch to a network error", async () => {
    const fetchImpl = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const client = createFundSnifferClient({ baseUrl: BASE, fetchImpl, sleep: async () => {} });
    await assert.rejects(client.search("x"), (error: unknown) => {
      assert.ok(error instanceof FundSnifferError);
      assert.equal(error.code, "network");
      return true;
    });
  });

  it("maps an aborted fetch to a timeout error", async () => {
    const fetchImpl = (async () => {
      const error = new Error("aborted");
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof fetch;
    const client = createFundSnifferClient({ baseUrl: BASE, fetchImpl, sleep: async () => {} });
    await assert.rejects(client.search("x"), (error: unknown) => {
      assert.ok(error instanceof FundSnifferError);
      assert.equal(error.code, "timeout");
      return true;
    });
  });

  it("throttles consecutive requests when minDelayMs is set", async () => {
    const slept: number[] = [];
    const { client } = clientWith([{ match: /suggest\/finde/, body: suggestFixture }], {
      minDelayMs: 500,
      sleep: async (ms: number) => {
        slept.push(ms);
      },
    });
    await client.search("a");
    await client.search("b");
    assert.equal(slept.length, 1);
    assert.ok(slept[0]! > 0 && slept[0]! <= 500);
  });
});

describe("extractIsinFromUrl", () => {
  it("reads a trailing ISIN from the slug", () => {
    assert.equal(extractIsinFromUrl(ETF_URL), "IE00B4L5Y983");
    assert.equal(extractIsinFromUrl(`${BASE}/fonds/x-lu1437020735`), "LU1437020735");
  });

  it("returns undefined when there is no ISIN", () => {
    assert.equal(extractIsinFromUrl(`${BASE}/etf/foo`), undefined);
    assert.equal(extractIsinFromUrl("not a url"), undefined);
  });
});
