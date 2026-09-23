import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractChartFromHtml, parseChartSrc } from "../src/parse/charts.ts";

const SRC =
  "https://c.finanzen.net/chart.aspx?c=sh&p=fin&s=fonds&stime=0" +
  "&labels=Oil+%26+Gas%3BRetail+-Cyclical%3BSonstige&values=4.1137;2.0292;27.67";

describe("parseChartSrc", () => {
  it("decodes labels and numeric values", () => {
    assert.deepEqual(parseChartSrc(SRC), {
      labels: ["Oil & Gas", "Retail -Cyclical", "Sonstige"],
      values: [4.1137, 2.0292, 27.67],
    });
  });

  it("accepts HTML-escaped ampersands in the src", () => {
    const escaped = SRC.replace(/&/g, "&amp;");
    assert.deepEqual(parseChartSrc(escaped), parseChartSrc(SRC));
  });

  it("returns null without labels or values", () => {
    assert.equal(parseChartSrc("https://x/chart.aspx?c=sh"), null);
    assert.equal(parseChartSrc("not a url"), null);
  });

  it("drops empty labels and non-numeric values", () => {
    const chart = parseChartSrc("https://x/chart.aspx?labels=A%3B%3BB&values=1;2;oops");
    assert.deepEqual(chart, { labels: ["A"], values: [1] });
  });
});

describe("extractChartFromHtml", () => {
  it("pulls the src out of an img fragment", () => {
    assert.deepEqual(extractChartFromHtml(`<img class="x" src="${SRC}">`), parseChartSrc(SRC));
  });

  it("handles single quotes and returns null without an image", () => {
    assert.deepEqual(extractChartFromHtml(`<img src='${SRC}'>`), parseChartSrc(SRC));
    assert.equal(extractChartFromHtml("<div>no image</div>"), null);
  });
});
