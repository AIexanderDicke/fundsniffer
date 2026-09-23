import { FundSnifferError } from "../errors.ts";
import type { BreakdownEntry, Holding } from "../types.ts";
import {
  byId,
  cellsOf,
  extractJsonObject,
  findFirst,
  findAll,
  hasClass,
  innerText,
  parseHtml,
  textOf,
  type HtmlElement,
} from "./html.ts";
import { extractChartFromHtml, parseChartSrc, type ChartData } from "./charts.ts";

/** Raw, source-shaped result of scraping one finanzen.net instrument page. */
export interface ParsedFund {
  name: string;
  /** Label -> value map of the "Wichtige Stammdaten" / key facts table. */
  keyFacts: Record<string, string>;
  topHoldings: Holding[];
  sectors: BreakdownEntry[];
  countries: BreakdownEntry[];
  instruments: BreakdownEntry[];
  morningstarRating?: number;
}

const OTHER_LABEL = "Sonstige";

/**
 * Labels the key-facts table is known to carry on both layouts. At least one
 * must be present, otherwise the page is not a fund page we understand and we
 * fail loudly instead of scraping unrelated two-cell rows.
 */
const ANCHOR_FACTS = [
  "Total Expense Ratio (TER)",
  "Ausschüttungsart",
  "Benchmark",
  "Fondswährung",
  "Währung",
] as const;

/** Composition chart keys used by the site. */
const CHART_KEYS = {
  instruments: "A",
  countries: "C",
  holdings: "H",
  sectors: "I",
} as const;

export function parseFundPage(html: string): ParsedFund {
  const root = parseHtml(html);

  return {
    name: parseName(root),
    keyFacts: parseKeyFacts(root),
    topHoldings: parseTopHoldings(root),
    sectors: toEntries(chart(root, CHART_KEYS.sectors)),
    countries: toEntries(chart(root, CHART_KEYS.countries)),
    instruments: toEntries(chart(root, CHART_KEYS.instruments)),
    morningstarRating: parseMorningstarRating(root),
  };
}

function parseName(root: HtmlElement): string {
  const heading = findFirst(root, (element) => element.tag === "h1");
  const headingText = heading ? innerText(heading) : "";
  if (headingText.length > 0) return headingText;

  const ogTitle = findFirst(
    root,
    (element) => element.tag === "meta" && element.attrs.property === "og:title",
  );
  const content = ogTitle?.attrs.content ?? "";
  return content
    .split("|")[0]!
    .replace(/\s*Kurs\s*$/i, "")
    .trim();
}

function parseKeyFacts(root: HtmlElement): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const row of findAll(root, (element) => element.tag === "tr")) {
    const cells = cellsOf(row);
    if (cells.length !== 2) continue;
    const label = innerText(cells[0]!);
    if (label.length === 0 || label in facts) continue;
    facts[label] = innerText(cells[1]!);
  }

  if (!ANCHOR_FACTS.some((label) => label in facts)) {
    throw new FundSnifferError(
      "Unrecognised fund page: no known key-facts row found, the layout may have changed",
      { code: "parse" },
    );
  }

  return facts;
}

function parseMorningstarRating(root: HtmlElement): number | undefined {
  const row = findFirst(
    root,
    (element) =>
      element.tag === "tr" && innerText(cellsOf(element)[0] ?? element) === "Morningstar Rating",
  );
  if (!row) return undefined;

  const filled = findAll(
    row,
    (element) => hasClass(element, "icon--star") && hasClass(element, "font-color-yellow"),
  );
  return filled.length > 0 ? filled.length : undefined;
}

function parseTopHoldings(root: HtmlElement): Holding[] {
  const fromTable = parseHoldingsTable(root);
  if (fromTable.length > 0) return fromTable;

  const holdingsChart = chart(root, CHART_KEYS.holdings);
  if (!holdingsChart) return [];

  return holdingsChart.labels
    .map((label, index) => ({ name: label, weight: holdingsChart.values[index]! }))
    .filter((holding) => holding.name !== OTHER_LABEL)
    .sort((a, b) => b.weight - a.weight);
}

function parseHoldingsTable(root: HtmlElement): Holding[] {
  const container = byId(root, "TopHoldings");
  if (!container) return [];

  const table = findFirst(container, (element) => element.tag === "table");
  if (!table) return [];

  const holdings: Holding[] = [];
  for (const row of findAll(table, (element) => element.tag === "tr")) {
    const cells = cellsOf(row);
    if (cells.length < 4) continue;
    const name = innerText(cells[0]!);
    const isin = innerText(cells[1]!);
    const weight = parsePercent(innerText(cells[3]!));
    if (name.length === 0 || weight === null || /^summe/i.test(name)) continue;
    holdings.push({
      name,
      isin: /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin) ? isin : undefined,
      weight,
    });
  }
  return holdings.sort((a, b) => b.weight - a.weight);
}

/**
 * Finds a composition chart by key. The ETF layout embeds all charts as a
 * `chartUrls` JSON object; the fund layout renders each chart as an
 * `<img>` inside a `#PieChartAllocationTypeX-content` container.
 */
function chart(root: HtmlElement, key: string): ChartData | null {
  return chartFromJson(root, key) ?? chartFromDiv(root, key);
}

function chartFromJson(root: HtmlElement, key: string): ChartData | null {
  const needle = `"PieChartAllocationType${key}"`;
  const script = findFirst(
    root,
    (element) => element.tag === "script" && textOf(element).includes(needle),
  );
  if (!script) return null;

  const json = extractJsonObject(textOf(script), needle);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const html = parsed[`PieChartAllocationType${key}`];
    return typeof html === "string" ? extractChartFromHtml(html) : null;
  } catch {
    return null;
  }
}

function chartFromDiv(root: HtmlElement, key: string): ChartData | null {
  const container = byId(root, `PieChartAllocationType${key}-content`);
  if (!container) return null;

  const image = findFirst(container, (element) => element.tag === "img");
  const src = image?.attrs.src;
  return src ? parseChartSrc(src) : null;
}

function toEntries(data: ChartData | null): BreakdownEntry[] {
  if (!data) return [];
  return data.labels
    .map((label, index) => ({ label, weight: data.values[index]! }))
    .sort((a, b) => b.weight - a.weight);
}

/** Parse "5,62 %" / "0,20 %" into 5.62 / 0.2. Returns null when unparsable. */
export function parsePercent(value: string): number | null {
  const compact = value.replace(/\s/g, "");
  const match = compact.match(/^([+-]?[\d.,]+)%?$/);
  if (!match) return null;
  const numeric = match[1]!.replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normalise a published percentage string to "0.20%". */
export function normalizePercentString(value: string): string | undefined {
  const compact = value.replace(/\s/g, "");
  if (compact.length === 0) return undefined;
  const match = compact.match(/^([+-]?[\d.,]+)%?$/);
  if (!match) return undefined;
  const normalized = match[1]!.replace(",", ".");
  if (!Number.isFinite(Number.parseFloat(normalized))) return undefined;
  return normalized.endsWith("%") ? normalized : `${normalized}%`;
}
