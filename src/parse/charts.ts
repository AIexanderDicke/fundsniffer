import { decodeEntities, normalizeSpace } from "./html.ts";

export interface ChartData {
  labels: string[];
  values: number[];
}

/**
 * finanzen.net renders composition breakdowns as pie chart images whose
 * `labels` / `values` query parameters carry the actual data. This turns such
 * an `<img src>` into a list of label/value pairs.
 */
export function parseChartSrc(src: string): ChartData | null {
  let url: URL;
  try {
    url = new URL(decodeEntities(src));
  } catch {
    return null;
  }

  const labelsParam = url.searchParams.get("labels");
  const valuesParam = url.searchParams.get("values");
  if (labelsParam === null || valuesParam === null) return null;

  const labels = labelsParam.split(";").map((label) => normalizeSpace(decodeEntities(label)));
  const values = valuesParam.split(";").map((value) => Number.parseFloat(value.replace(",", ".")));
  const length = Math.min(labels.length, values.length);

  const result: ChartData = { labels: [], values: [] };
  for (let index = 0; index < length; index += 1) {
    const label = labels[index]!;
    const value = values[index]!;
    if (label.length === 0 || !Number.isFinite(value)) continue;
    result.labels.push(label);
    result.values.push(value);
  }

  return result.labels.length > 0 ? result : null;
}

/** Pull the first `<img src>` out of an HTML fragment and parse its chart. */
export function extractChartFromHtml(html: string): ChartData | null {
  const match = html.match(/src\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  if (!match) return null;
  return parseChartSrc(match[1] ?? match[2] ?? "");
}
