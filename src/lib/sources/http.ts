/**
 * Shared HTTP behaviour for the external metadata APIs.
 *
 * Both OpenAlex and Crossref run a "polite pool" with materially better rate
 * limits for clients that identify themselves, and both will throttle or ban
 * anonymous high-volume traffic. This module makes identification and paced,
 * backing-off retries the only way to reach them.
 */

import { sources } from '../config';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Serialises requests per host so we never burst past the published limits. */
const lastRequestAt = new Map<string, number>();

async function pace(host: string, intervalMs: number): Promise<void> {
  const previous = lastRequestAt.get(host) ?? 0;
  const wait = previous + intervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The contact address sent to both APIs.
 *
 * Throws rather than falling back to a placeholder: crawling anonymously (or
 * worse, as someone else's address) gets the project rate-limited and is bad
 * citizenship toward two free public services.
 */
export function requireContactEmail(): string {
  const email = sources.contactEmail.trim();
  if (!email || !email.includes('@') || /example\.(com|org|net)$/i.test(email)) {
    throw new Error(
      'GEIGER_CONTACT_EMAIL must be set to a real address you monitor.\n' +
        'OpenAlex and Crossref use it to reach you about crawl behaviour, and it is\n' +
        'what puts requests in the polite pool. Add it to .env before running ingest.',
    );
  }
  return email;
}

export interface FetchJsonOptions {
  /** Retries on 429/5xx/network errors. */
  maxRetries?: number;
  /** Minimum gap between requests to the same host. */
  intervalMs?: number;
  signal?: AbortSignal;
  /** 404 is often "not indexed" rather than an error; return null instead. */
  nullOn404?: boolean;
}

/**
 * GET a JSON document with pacing, retry and exponential backoff.
 *
 * Honours `Retry-After` when the server sends it, because guessing at a
 * backoff the server has already told you is unhelpful.
 */
export async function fetchJson<T>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<T | null> {
  const maxRetries = options.maxRetries ?? sources.maxRetries;
  const intervalMs = options.intervalMs ?? sources.requestIntervalMs;
  const host = new URL(url).host;
  const email = requireContactEmail();

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    await pace(host, intervalMs);

    try {
      const response = await fetch(url, {
        signal: options.signal,
        headers: {
          Accept: 'application/json',
          // Both APIs document this header as the polite-pool signal.
          'User-Agent': `ProjectGeiger/1.0 (mailto:${email})`,
        },
      });

      if (response.status === 404 && options.nullOn404) return null;

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30_000, 500 * 2 ** attempt);
        lastError = new HttpError(
          `${response.status} ${response.statusText}`,
          response.status,
          url,
        );
        if (attempt < maxRetries) {
          await sleep(backoff);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        throw new HttpError(
          `${response.status} ${response.statusText}`,
          response.status,
          url,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      // A thrown HttpError for a non-retryable status should surface as-is.
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) {
        throw error;
      }
      lastError = error;
      if (attempt < maxRetries) {
        await sleep(Math.min(30_000, 500 * 2 ** attempt));
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Request failed after ${maxRetries + 1} attempts: ${url}`);
}
