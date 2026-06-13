/**
 * Retry + timeout helpers for LLM HTTP calls. Three attempts with
 * exponential backoff (1s, 2s, 4s) by default. Retries on network
 * failures, 429, 5xx; surfaces 4xx to the caller as-is.
 */

export interface RetryOpts {
  maxAttempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  onRetry?: (attempt: number, err: Error, delayMs: number) => void;
}

export class HttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "HttpError";
  }
}

export function isRetriable(err: unknown): boolean {
  if (err instanceof HttpError) {
    return err.status === 429 || (err.status >= 500 && err.status < 600);
  }
  // Network / timeout / DNS — all retriable
  return true;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const max = opts.maxAttempts ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  const timeout = opts.timeoutMs ?? 120_000;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await runWithTimeout(fn, timeout);
    } catch (err) {
      lastErr = err;
      if (attempt === max || !isRetriable(err)) throw err;
      const delay = base * 2 ** (attempt - 1);
      opts.onRetry?.(attempt, err as Error, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function runWithTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`LLM request timed out after ${ms}ms`)), ms);
    fn().then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
