import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

export function fixtureJson<T = unknown>(name: string): T {
  return JSON.parse(fixture(name)) as T;
}

export interface Route {
  match: RegExp;
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

export type ScriptedFetch = typeof fetch & {
  calls: string[];
  headers: Headers[];
};

/**
 * A fake `fetch` that answers with a fixed script of responses, in order.
 * The last step repeats once the script is exhausted. Useful for exercising
 * retries, `Retry-After` and conditional requests.
 */
export function scriptedFetch(
  steps: Array<Response | (() => Response | Promise<Response>)>,
): ScriptedFetch {
  const calls: string[] = [];
  const headers: Headers[] = [];
  let index = 0;

  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push(urlOf(input));
    headers.push(new Headers(init?.headers));
    const step = steps[Math.min(index, steps.length - 1)]!;
    index += 1;
    return typeof step === "function" ? await step() : step;
  }) as typeof fetch & { calls: string[]; headers: Headers[] };

  impl.calls = calls;
  impl.headers = headers;
  return impl;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as { url: string }).url;
}

/** A fake `fetch` that answers requests based on URL patterns. */
export function routedFetch(routes: Route[]): typeof fetch {
  const calls: string[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as { url: string }).url;
    calls.push(url);
    const route = routes.find((candidate) => candidate.match.test(url));
    if (!route) throw new Error(`Unexpected fetch: ${url}`);
    return new Response(route.body ?? null, {
      status: route.status ?? 200,
      headers: route.headers,
    });
  }) as typeof fetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}
