import type { FundInfo } from "./types.ts";
import { normalizePercentString, type ParsedFund } from "./parse/page.ts";

export const SOURCE = "finanzen.net";

export interface ToFundInfoOptions {
  isin: string;
  url?: string;
  wkn?: string;
  /** Display name from the search hit; preferred over the scraped `<h1>`. */
  name?: string;
  /** Set when the page was served from cache after a failed refresh. */
  stale?: boolean;
}

/** Map a scraped page onto the public `FundInfo` shape. */
export function toFundInfo(parsed: ParsedFund, options: ToFundInfoOptions): FundInfo {
  const facts = parsed.keyFacts;
  const topHoldings = parsed.topHoldings;
  const coverage = topHoldings.reduce((sum, holding) => sum + holding.weight, 0) / 100;

  return {
    isin: options.isin.toUpperCase(),
    name: (options.name?.trim() || parsed.name).trim() || options.isin.toUpperCase(),
    currency: pick(facts, ["Fondswährung", "Währung"]),
    ter: normalizePercentString(pick(facts, ["Total Expense Ratio (TER)"]) ?? ""),
    assetClass: pick(facts, ["Kategorie"]),
    distribution: pick(facts, ["Ausschüttungsart"]),
    benchmark: pick(facts, ["Benchmark"]),
    source: SOURCE,
    stale: options.stale ?? false,
    topHoldings,
    coverage,
    breakdowns: {
      sector: parsed.sectors,
      geography: parsed.countries,
    },
    wkn: options.wkn || undefined,
    url: options.url,
    issuer: pick(facts, ["Emittent", "Fondsgesellschaft"]),
    fundSize: pick(facts, ["Fondsgröße", "Fondsvolumen"]),
    replication: pick(facts, ["Replikationsart"]),
    launchDate: pick(facts, ["Auflagedatum"]),
    morningstarRating: parsed.morningstarRating,
    assetAllocation: parsed.instruments.length > 0 ? parsed.instruments : undefined,
  };
}

function pick(facts: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = facts[key]?.trim();
    if (value) return value;
  }
  return undefined;
}
