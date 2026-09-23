export type FundSnifferErrorCode = "invalid" | "blocked" | "not_found" | "timeout" | "network" | "parse";

export interface FundSnifferErrorOptions {
  code: FundSnifferErrorCode;
  status?: number;
  cause?: unknown;
  /** Server-requested wait before retrying, in milliseconds (from `Retry-After`). */
  retryAfterMs?: number;
}

/** Error thrown for every failure that is not "the instrument does not exist". */
export class FundSnifferError extends Error {
  readonly code: FundSnifferErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, options: FundSnifferErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FundSnifferError";
    this.code = options.code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function isFundSnifferError(value: unknown): value is FundSnifferError {
  return value instanceof FundSnifferError;
}
