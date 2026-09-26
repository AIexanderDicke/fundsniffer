/**
 * Public data model of the wrapper.
 *
 * `FundInfo` is the normalized shape returned for a fund or ETF looked up on
 * finanzen.net.
 */

/** A single constituent of a fund. */
export interface Holding {
  name: string;
  isin?: string;
  ticker?: string;
  /** Weight inside the fund, in percent (0..100). */
  weight: number;
}

export interface BreakdownEntry {
  label: string;
  /** Weight inside the fund, in percent (0..100). */
  weight: number;
}

/** Fund-level look-through categories. Arrays may be empty or partial. */
export interface Breakdowns {
  sector: BreakdownEntry[];
  geography: BreakdownEntry[];
}

export type BreakdownKind = keyof Breakdowns;

export interface FundInfo {
  isin: string;
  name: string;
  currency?: string;
  /** Total expense ratio, normalised (e.g. "0.20%"). */
  ter?: string;
  assetClass?: string;
  distribution?: string;
  /** Number of constituents in the fund, when published. */
  holdingsCount?: number;
  /** SRRI-style risk rating (1..7), when published. */
  riskRating?: number;
  benchmark?: string;
  /** Where the payload came from, always "finanzen.net" here. */
  source: string;
  /** True when this is a cached payload that could not be refreshed. */
  stale: boolean;
  /** Publication date of the underlying figures (ISO date), when published. */
  dataAsOf?: string;
  topHoldings: Holding[];
  /** Share of the fund explained by topHoldings, 0..1. */
  coverage: number;
  /** Sector / country exposure, when published. */
  breakdowns?: Breakdowns;

  /** Extra finanzen.net fields beyond the core model. */
  wkn?: string;
  /** Canonical finanzen.net page URL. */
  url?: string;
  /** Issuer / fund company (Emittent / Fondsgesellschaft). */
  issuer?: string;
  /** Fund size as published (e.g. "131.969.453.745,29"). */
  fundSize?: string;
  /** Replication method (Replikationsart), ETFs only. */
  replication?: string;
  /** Launch date as published (e.g. "25.09.2009"). */
  launchDate?: string;
  /** Morningstar rating in stars (0..5), when published. */
  morningstarRating?: number;
  /** Asset allocation (Aktien/Barmittel/Sonstiges ...), when published. */
  assetAllocation?: BreakdownEntry[];
}

/** One hit from the finanzen.net search / suggestion endpoint. */
export interface SearchResult {
  /** ISIN, when the hit is an instrument (null for ads). */
  isin?: string;
  /** WKN, when available. */
  wkn?: string;
  /** Display name (plain text, ads have their HTML stripped). */
  name: string;
  /** Absolute URL of the instrument page. */
  url: string;
  /** Group label as reported by the site, e.g. "ETFs", "Fonds", "Aktien". */
  type: string;
}
