/**
 * Request validation, rate limiting and error shaping for the public API.
 *
 * Geiger's API is meant to be used by other people's code — integrity tools,
 * journal workflows, scripts — so it has to behave like a public API: validated
 * input, predictable error bodies, and a rate limit that protects the database
 * from a single enthusiastic client.
 */

import { NextResponse } from 'next/server';
import { limits, rateLimit } from '../config';

export interface ApiErrorBody {
  error: string;
  detail?: string;
  /** What the caller should do about it. Errors that cannot be acted on are bugs. */
  hint?: string;
}

export function apiError(
  status: number,
  error: string,
  extra: Omit<ApiErrorBody, 'error'> = {},
): NextResponse {
  return NextResponse.json({ error, ...extra } satisfies ApiErrorBody, { status });
}

/** Cache headers for responses derived from precomputed data. */
export function cached(data: unknown, ttlSeconds: number): NextResponse {
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`,
    },
  });
}

/**
 * In-process fixed-window rate limiter.
 *
 * Deliberately simple and deliberately per-instance: it stops one client from
 * hammering a single server, which is the realistic failure mode here. A
 * multi-instance deployment should point this at Redis instead — the interface
 * is the same, and that is the only change needed.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(key: string, max = rateLimit.maxRequests): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + rateLimit.windowMs;
    windows.set(key, { count: 1, resetAt });
    // Opportunistic sweep so the map cannot grow without bound.
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    }
    return { allowed: true, remaining: max - 1, resetAt };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= max,
    remaining: Math.max(0, max - existing.count),
    resetAt: existing.resetAt,
  };
}

/** Best-effort client identity behind a proxy. */
export function clientKey(request: Request, scope = 'default'): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
  return `${scope}:${ip}`;
}

export function rateLimited(result: RateLimitResult): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      hint: `Retry in ${retryAfter}s. Contact us if you need a higher limit for research use.`,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Remaining': String(result.remaining),
      },
    },
  );
}

/**
 * Guard a handler with rate limiting and uniform error handling.
 *
 * Internal errors are logged in full and returned as a generic message: a
 * stack trace in a public API response is an information leak, and a database
 * error string is meaningless to the caller anyway.
 */
export async function guarded(
  request: Request,
  // Response rather than NextResponse: file downloads stream a plain Response.
  handler: () => Promise<Response>,
  options: { scope?: string; max?: number } = {},
): Promise<Response> {
  const scope = options.scope ?? 'default';
  const result = checkRateLimit(clientKey(request, scope), options.max);
  if (!result.allowed) return rateLimited(result);

  try {
    const response = await handler();
    response.headers.set('X-RateLimit-Remaining', String(result.remaining));
    return response;
  } catch (error) {
    console.error(`[api:${scope}]`, error);
    if (error instanceof ValidationError) {
      return apiError(400, error.message, { hint: error.hint });
    }
    return apiError(500, 'Internal server error', {
      hint: 'This is a bug on our side. If it persists, please report it.',
    });
  }
}

export class ValidationError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/* ---------------------------------------------------------------------- */
/* Parameter parsing                                                       */
/* ---------------------------------------------------------------------- */

/**
 * Validate a DOI from a path segment.
 *
 * Queries use bound parameters so this is not an injection guard; it exists so
 * that a malformed identifier produces a clear 400 instead of an empty graph
 * that looks like "no contamination found".
 */
export function parseDoi(segments: string[]): string {
  const raw = decodeURIComponent(segments.join('/')).trim();
  if (!raw) throw new ValidationError('No DOI supplied', 'Add a DOI to the URL, e.g. /api/paper/10.1038/nature04533');

  const cleaned = raw
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();

  if (!/^10\.\d{4,9}\/\S+$/.test(cleaned)) {
    throw new ValidationError(
      `"${raw}" is not a valid DOI`,
      'A DOI looks like 10.1038/nature04533. You can also paste a full doi.org URL.',
    );
  }

  return cleaned.toLowerCase();
}

export function parseInt(
  value: string | null,
  { min, max, fallback, name }: { min: number; max: number; fallback: number; name: string },
): number {
  if (value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`${name} must be a number`, `Received "${value}".`);
  }
  const truncated = Math.trunc(parsed);
  if (truncated < min || truncated > max) {
    throw new ValidationError(
      `${name} must be between ${min} and ${max}`,
      `Received ${truncated}.`,
    );
  }
  return truncated;
}

const DIRECTIONS = ['downstream', 'upstream', 'both'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export function parseDirection(value: string | null): Direction {
  if (!value) return 'downstream';
  if (!DIRECTIONS.includes(value as Direction)) {
    throw new ValidationError(
      `direction must be one of: ${DIRECTIONS.join(', ')}`,
      'downstream shows papers affected by this one; upstream shows what it relies on.',
    );
  }
  return value as Direction;
}

const STATUSES = ['clean', 'corrected', 'concerned', 'retracted'];

export function parseStatuses(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const requested = value.split(',').map((s) => s.trim()).filter(Boolean);
  const invalid = requested.filter((s) => !STATUSES.includes(s));
  if (invalid.length) {
    throw new ValidationError(
      `Unknown status: ${invalid.join(', ')}`,
      `Valid values: ${STATUSES.join(', ')}.`,
    );
  }
  return requested.length ? requested : undefined;
}

/** Standard graph query parameters, validated together. */
export function parseGraphParams(url: URL) {
  return {
    direction: parseDirection(url.searchParams.get('direction')),
    depth: parseInt(url.searchParams.get('depth'), {
      min: 1, max: limits.maxGraphDepth, fallback: limits.defaultGraphDepth, name: 'depth',
    }),
    limit: parseInt(url.searchParams.get('limit'), {
      min: 1, max: limits.maxGraphNodes, fallback: limits.defaultGraphNodes, name: 'limit',
    }),
    yearFrom: url.searchParams.get('yearFrom')
      ? parseInt(url.searchParams.get('yearFrom'), { min: 1500, max: 2100, fallback: 0, name: 'yearFrom' })
      : undefined,
    yearTo: url.searchParams.get('yearTo')
      ? parseInt(url.searchParams.get('yearTo'), { min: 1500, max: 2100, fallback: 0, name: 'yearTo' })
      : undefined,
    minScore: url.searchParams.get('minScore')
      ? parseInt(url.searchParams.get('minScore'), { min: 0, max: 100, fallback: 0, name: 'minScore' })
      : undefined,
    statuses: parseStatuses(url.searchParams.get('status')),
  };
}
