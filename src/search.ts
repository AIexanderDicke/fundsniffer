import type { SearchResult } from "./types.ts";
import { decodeEntities, normalizeSpace } from "./parse/html.ts";

export const SUGGEST_PATH = "/suggest/finde/jsonv2";
export const AD_GROUP = "Anzeige";

/** Build the URL of the site's search-field suggestion endpoint. */
export function buildSuggestUrl(baseUrl: string, query: string, maxResults = 10): string {
  const url = new URL(SUGGEST_PATH, baseUrl);
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("Keywords_mode", "APPROX");
  url.searchParams.set("Keywords", query);
  url.searchParams.set("query", query);
  url.searchParams.set("bias", "100");
  return url.toString();
}

interface SuggestItem {
  wkn?: string | null;
  isin?: string | null;
  n?: string | null;
  u?: string | null;
}

interface SuggestGroup {
  n?: string | null;
  il?: SuggestItem[] | null;
}

/**
 * Turn the suggestion payload into a flat list of hits.
 * `Anzeige` (advertisement) groups are included and tagged, so callers can
 * decide whether to keep them.
 */
export function parseSuggestResults(json: unknown, baseUrl: string): SearchResult[] {
  const groups = (json as { it?: SuggestGroup[] } | null)?.it;
  if (!Array.isArray(groups)) return [];

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    const type = normalizeSpace(decodeEntities(group.n ?? ""));
    const items = Array.isArray(group.il) ? group.il : [];
    for (const item of items) {
      const rawUrl = item.u?.trim();
      if (!rawUrl) continue;

      let url: string;
      try {
        url = new URL(decodeEntities(rawUrl), baseUrl).toString();
      } catch {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);

      results.push({
        isin: normalizeIsin(item.isin),
        wkn: item.wkn?.trim() || undefined,
        name: normalizeSpace(decodeEntities(stripTags(item.n ?? ""))),
        url,
        type,
      });
    }
  }

  return results;
}

export function isAd(result: SearchResult): boolean {
  return result.type === AD_GROUP;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function normalizeIsin(value: string | null | undefined): string | undefined {
  const isin = value?.trim().toUpperCase();
  return isin ? isin : undefined;
}
