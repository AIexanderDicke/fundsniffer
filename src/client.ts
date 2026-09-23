import { FundSnifferError, isFundSnifferError } from "./errors.ts";
import { HttpClient, type HttpClientOptions } from "./http.ts";
import { hasIsinShape, isValidIsin, normalizeIsin } from "./isin.ts";
import { toFundInfo } from "./normalize.ts";
import { parseFundPage } from "./parse/page.ts";
import { buildSuggestUrl, isAd, parseSuggestResults } from "./search.ts";
import type { FundInfo, SearchResult } from "./types.ts";

export const DEFAULT_BASE_URL = "https://www.finanzen.net";

export interface FundSnifferClientOptions extends HttpClientOptions {
  baseUrl?: string;
}

export interface SearchOptions {
  maxResults?: number;
  /** Keep advertisement hits (group "Anzeige"). Defaults to false. */
  includeAds?: boolean;
}

export interface GetFundByUrlOptions {
  isin?: string;
  wkn?: string;
  name?: string;
}

export interface FundSnifferClient {
  readonly baseUrl: string;
  /** Search the site's search field. Returns instrument hits, ads excluded by default. */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  /** Resolve an ISIN to its instrument page. Returns null when unknown. */
  findByIsin(isin: string): Promise<SearchResult | null>;
  /** Scrape an ISIN's page into a `FundInfo`. Returns null when the ISIN is unknown. */
  getFund(isin: string): Promise<FundInfo | null>;
  /** Scrape an already-resolved instrument page. */
  getFundByUrl(url: string, options?: GetFundByUrlOptions): Promise<FundInfo>;
}

/** Instrument pages we know how to turn into a `FundInfo`. */
const FUND_PAGE = /\/(etf|fonds)\//i;

export function createFundSnifferClient(options: FundSnifferClientOptions = {}): FundSnifferClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const http = new HttpClient(options);

  const search: FundSnifferClient["search"] = async (query, searchOptions = {}) => {
    const url = buildSuggestUrl(baseUrl, query, searchOptions.maxResults ?? 10);
    const response = await http.get(url, { accept: "application/json" });

    let json: unknown;
    try {
      json = JSON.parse(response.text);
    } catch (error) {
      throw new FundSnifferError(`Could not parse the search response for "${query}"`, {
        code: "parse",
        cause: error,
      });
    }

    const results = parseSuggestResults(json, baseUrl);
    return searchOptions.includeAds ? results : results.filter((result) => !isAd(result));
  };

  const resolveByRedirect = async (isin: string): Promise<string | null> => {
    let current = `${baseUrl}/suchergebnis.asp?strSuchString=${encodeURIComponent(isin)}&strKat=ETFs`;

    for (let hop = 0; hop < 3; hop += 1) {
      const response = await http.get(current, { redirect: "manual" });
      if (response.status >= 300 && response.status < 400 && response.location) {
        current = new URL(response.location, current).toString();
        continue;
      }
      break;
    }

    return FUND_PAGE.test(new URL(current).pathname) ? current : null;
  };

  const findByIsin: FundSnifferClient["findByIsin"] = async (isin) => {
    const normalized = normalizeIsin(isin);
    if (!hasIsinShape(normalized)) return null;

    try {
      const results = await search(normalized, { maxResults: 10 });
      const match = results.find((result) => result.isin === normalized);
      if (match) return match;
    } catch (error) {
      // The suggestion endpoint occasionally rate-limits; fall back to the
      // search-result redirect instead of failing the whole lookup.
      if (!isFundSnifferError(error) || !["blocked", "network", "timeout"].includes(error.code)) {
        throw error;
      }
    }

    const url = await resolveByRedirect(normalized);
    return url ? { isin: normalized, name: "", url, type: "" } : null;
  };

  const getFundByUrl: FundSnifferClient["getFundByUrl"] = async (url, fundOptions = {}) => {
    const response = await http.get(url);
    if (response.status === 404) {
      throw new FundSnifferError(`No fund page at ${url}`, { code: "not_found", status: 404 });
    }

    const isin = fundOptions.isin ?? extractIsinFromUrl(url);
    if (!isin) {
      throw new FundSnifferError(`Could not determine the ISIN for ${url}`, { code: "parse" });
    }

    const parsed = parseFundPage(response.text);
    return toFundInfo(parsed, {
      isin,
      url,
      wkn: fundOptions.wkn,
      name: fundOptions.name,
      stale: response.stale,
    });
  };

  const getFund: FundSnifferClient["getFund"] = async (isin) => {
    const normalized = normalizeIsin(isin);
    if (!isValidIsin(normalized)) {
      throw new FundSnifferError(`Invalid ISIN: ${isin}`, { code: "invalid" });
    }

    const hit = await findByIsin(normalized);
    if (!hit || !FUND_PAGE.test(new URL(hit.url).pathname)) return null;

    return getFundByUrl(hit.url, { isin: normalized, wkn: hit.wkn, name: hit.name });
  };

  return { baseUrl, search, findByIsin, getFund, getFundByUrl };
}

/** finanzen.net URLs end in `-<isin>`; recover it from the last path segment. */
export function extractIsinFromUrl(url: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }

  const slug = pathname.split("/").filter(Boolean).pop() ?? "";
  const candidate = slug.slice(-12).toUpperCase();
  return hasIsinShape(candidate) ? candidate : undefined;
}
