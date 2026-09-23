import { FundSnifferError } from "./errors.ts";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** A cached response body, revalidated with conditional request headers. */
export interface CacheEntry {
  text: string;
  etag?: string;
  lastModified?: string;
}

/** Storage for conditional requests and stale fallbacks. */
export interface ResponseCache {
  get(url: string): CacheEntry | undefined;
  set(url: string, entry: CacheEntry): void;
}

/** Bounded in-memory {@link ResponseCache}; the oldest entry is evicted first. */
export function createMemoryCache(limit = 50): ResponseCache {
  const entries = new Map<string, CacheEntry>();
  return {
    get(url) {
      return entries.get(url);
    },
    set(url, entry) {
      entries.delete(url);
      entries.set(url, entry);
      while (entries.size > limit) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}

export interface HttpClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  /** Minimum gap between two requests, to stay polite. 0 disables it. */
  minDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Retries after the first attempt for `blocked` / `network` / `timeout` errors. */
  retries?: number;
  /** Base delay for the exponential backoff between retries. */
  retryBaseDelayMs?: number;
  /** Upper bound for a single backoff / `Retry-After` wait. */
  maxRetryDelayMs?: number;
  /** Random source for backoff jitter; injectable for deterministic tests. */
  random?: () => number;
  /**
   * Conditional-request caching. `true` uses a bounded in-memory cache.
   * Off by default: caching is a caller policy and retains page bodies.
   */
  cache?: boolean | ResponseCache;
}

export type RedirectMode = "follow" | "manual" | "error";

export interface HttpGetOptions {
  accept?: string;
  redirect?: RedirectMode;
  /** Override the client's retry count for this request. */
  retries?: number;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  text: string;
  location: string | null;
  /** True when a cached body was served because the refresh failed. */
  stale: boolean;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_CODES = new Set(["blocked", "network", "timeout"]);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Minimal HTTP client for finanzen.net.
 *
 * Akamai fronts the site, so every request carries a browser-like
 * `User-Agent` / `Accept-Language`. A 403 or 429 is surfaced as a distinct
 * "blocked" error, retried with exponential backoff and, when a cache is
 * configured, served from the last good body (marked `stale`).
 */
export class HttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly minDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retries: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly random: () => number;
  private readonly cache: ResponseCache | null;
  private lastRequestAt = 0;
  private throttleChain: Promise<void> = Promise.resolve();

  constructor(options: HttpClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.minDelayMs = options.minDelayMs ?? 1000;
    this.sleep = options.sleep ?? defaultSleep;
    this.retries = Math.max(0, options.retries ?? 2);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000;
    this.random = options.random ?? Math.random;
    this.cache = resolveCache(options.cache);
  }

  async get(url: string, options: HttpGetOptions = {}): Promise<HttpResponse> {
    const maxRetries = Math.max(0, options.retries ?? this.retries);
    const useCache = this.cache !== null && (options.redirect ?? "follow") !== "manual";
    let attempt = 0;

    for (;;) {
      await this.throttle();
      try {
        return await this.request(url, options, useCache);
      } catch (error) {
        if (!isRetryable(error)) throw error;

        if (attempt < maxRetries) {
          await this.sleep(this.backoffDelay(error, attempt));
          attempt += 1;
          continue;
        }

        const cached = useCache ? this.cache!.get(url) : undefined;
        if (cached) {
          return { status: 200, ok: true, text: cached.text, location: null, stale: true };
        }
        throw error;
      }
    }
  }

  private async request(
    url: string,
    options: HttpGetOptions,
    useCache: boolean,
  ): Promise<HttpResponse> {
    const cached = useCache ? this.cache!.get(url) : undefined;
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Accept: options.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        redirect: options.redirect ?? "follow",
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new FundSnifferError(`Request timed out after ${this.timeoutMs}ms: ${url}`, {
          code: "timeout",
          cause: error,
        });
      }
      throw new FundSnifferError(`Network error for ${url}`, { code: "network", cause: error });
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (isAbortError(error)) {
        throw new FundSnifferError(`Request timed out after ${this.timeoutMs}ms: ${url}`, {
          code: "timeout",
          cause: error,
        });
      }
      throw new FundSnifferError(`Network error reading the response for ${url}`, {
        code: "network",
        cause: error,
      });
    }

    if (response.status === 304 && cached) {
      return { status: 200, ok: true, text: cached.text, location: null, stale: false };
    }

    if (response.status === 403 || response.status === 429) {
      throw new FundSnifferError(
        `finanzen.net blocked the request (HTTP ${response.status}); slow down or retry later: ${url}`,
        {
          code: "blocked",
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
        },
      );
    }
    if (!response.ok && response.status !== 404 && !REDIRECT_STATUSES.has(response.status)) {
      throw new FundSnifferError(`finanzen.net responded HTTP ${response.status} for ${url}`, {
        code: "network",
        status: response.status,
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
      });
    }

    if (useCache && response.ok && response.status === 200) {
      this.cache!.set(url, {
        text,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
      });
    }

    return {
      status: response.status,
      ok: response.ok,
      text,
      location: response.headers.get("location"),
      stale: false,
    };
  }

  private backoffDelay(error: unknown, attempt: number): number {
    const retryAfter = error instanceof FundSnifferError ? error.retryAfterMs : undefined;
    if (retryAfter !== undefined) return Math.min(retryAfter, this.maxRetryDelayMs);

    const exponential = this.retryBaseDelayMs * 2 ** attempt;
    const jitter = this.random() * this.retryBaseDelayMs;
    return Math.min(exponential + jitter, this.maxRetryDelayMs);
  }

  /** Serialises requests so concurrent callers respect the politeness gap. */
  private throttle(): Promise<void> {
    const run = this.throttleChain.then(() => this.waitForSlot());
    this.throttleChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async waitForSlot(): Promise<void> {
    if (this.minDelayMs > 0) {
      const wait = this.lastRequestAt + this.minDelayMs - Date.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequestAt = Date.now();
  }
}

/** Parse a `Retry-After` header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function resolveCache(cache: HttpClientOptions["cache"]): ResponseCache | null {
  if (cache === true) return createMemoryCache();
  if (!cache) return null;
  return cache;
}

function isRetryable(error: unknown): boolean {
  return error instanceof FundSnifferError && RETRYABLE_CODES.has(error.code);
}

function isAbortError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}
