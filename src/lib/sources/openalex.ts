/**
 * OpenAlex client.
 *
 * OpenAlex is the backbone of the dataset: CC0, complete enough to walk
 * citations in both directions, and the only free source that exposes
 * `cites:` filtering, which is what makes downstream traversal possible at all.
 */

import { sources } from '../config';
import type { Author, IntegrityStatus, PaperNode } from '../types';
import { fetchJson, requireContactEmail } from './http';

/** The subset of the OpenAlex work schema Geiger relies on. */
export interface OpenAlexWork {
  id: string;
  doi: string | null;
  title: string | null;
  display_name?: string | null;
  publication_year: number | null;
  publication_date: string | null;
  type: string | null;
  is_retracted: boolean;
  is_paratext: boolean;
  cited_by_count: number;
  referenced_works_count: number;
  referenced_works: string[];
  authorships?: { author?: { id?: string; display_name?: string; orcid?: string } }[];
  primary_location?: { source?: { display_name?: string } | null } | null;
  concepts?: { display_name: string; score: number }[];
  ids?: Record<string, string>;
}

interface OpenAlexPage<T> {
  results: T[];
  meta: { count: number; next_cursor?: string | null; per_page: number };
}

/** Field mask sent on every request; keeps payloads small and crawls fast. */
const WORK_FIELDS = [
  'id', 'doi', 'title', 'display_name', 'publication_year', 'publication_date',
  'type', 'is_retracted', 'is_paratext', 'cited_by_count',
  'referenced_works_count', 'referenced_works', 'authorships',
  'primary_location', 'concepts', 'ids',
].join(',');

function base(): string {
  return sources.openAlexBase.replace(/\/$/, '');
}

function withContact(url: URL): string {
  url.searchParams.set('mailto', requireContactEmail());
  return url.toString();
}

/** Strip the OpenAlex URL prefix to the bare work ID (`W2075481535`). */
export function shortId(id: string): string {
  return id.replace(/^https?:\/\/openalex\.org\//i, '');
}

/** Normalise a DOI to bare `10.x/y` form, accepting URLs and `doi:` prefixes. */
export function normaliseDoi(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const cleaned = trimmed
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;)\]]+$/, '')
    .trim();
  return /^10\.\d{4,9}\/\S+$/.test(cleaned) ? cleaned.toLowerCase() : null;
}

export function fetchWorkByDoi(doi: string): Promise<OpenAlexWork | null> {
  const url = new URL(`${base()}/works/https://doi.org/${doi}`);
  url.searchParams.set('select', WORK_FIELDS);
  return fetchJson<OpenAlexWork>(withContact(url), { nullOn404: true });
}

export function fetchWorkById(id: string): Promise<OpenAlexWork | null> {
  const url = new URL(`${base()}/works/${shortId(id)}`);
  url.searchParams.set('select', WORK_FIELDS);
  return fetchJson<OpenAlexWork>(withContact(url), { nullOn404: true });
}

/**
 * Fetch many works by ID.
 *
 * OpenAlex accepts up to 50 OR-ed IDs per filter, so this is ~50x cheaper than
 * fetching them one at a time and is the only practical way to hydrate a
 * crawl frontier.
 */
export async function fetchWorksByIds(ids: string[]): Promise<OpenAlexWork[]> {
  const unique = [...new Set(ids.map(shortId))].filter(Boolean);
  const results: OpenAlexWork[] = [];

  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const url = new URL(`${base()}/works`);
    url.searchParams.set('filter', `openalex:${chunk.join('|')}`);
    url.searchParams.set('per-page', '50');
    url.searchParams.set('select', WORK_FIELDS);
    const page = await fetchJson<OpenAlexPage<OpenAlexWork>>(withContact(url));
    if (page?.results) results.push(...page.results);
  }

  return results;
}

/** How to spend a limited sampling budget across a paper's citing works. */
export type CitationSampling = 'influential' | 'recent' | 'balanced';

async function fetchCitingPage(
  workId: string,
  limit: number,
  sort: string,
): Promise<{ works: OpenAlexWork[]; total: number }> {
  const works: OpenAlexWork[] = [];
  let cursor = '*';
  let total = 0;

  while (works.length < limit) {
    const url = new URL(`${base()}/works`);
    url.searchParams.set('filter', `cites:${shortId(workId)}`);
    url.searchParams.set('per-page', String(Math.min(200, limit - works.length)));
    url.searchParams.set('cursor', cursor);
    url.searchParams.set('select', WORK_FIELDS);
    url.searchParams.set('sort', sort);

    const page = await fetchJson<OpenAlexPage<OpenAlexWork>>(withContact(url));
    if (!page?.results?.length) break;

    total = page.meta.count;
    works.push(...page.results);

    const next = page.meta.next_cursor;
    if (!next) break;
    cursor = next;
  }

  return { works: works.slice(0, limit), total };
}

/**
 * Works that cite the given work — the downstream/contamination direction.
 *
 * This is the call the original crawler was missing entirely, and without it
 * the dataset cannot answer the question the product is named after.
 *
 * Sampling strategy matters more than it looks. Highly-cited papers have far
 * more citers than any budget can hold, and sorting purely by citation count
 * biases hard toward older work — a citation needs years to accumulate. On a
 * paper retracted recently that silently excludes every post-retraction
 * citation, which is the single signal the tool exists to surface. `balanced`
 * therefore splits the budget between the most influential citers and the most
 * recent ones.
 */
export async function fetchCitingWorks(
  workId: string,
  options: {
    limit?: number;
    sampling?: CitationSampling;
    onPage?: (count: number, total: number) => void;
  } = {},
): Promise<{ works: OpenAlexWork[]; total: number }> {
  const limit = options.limit ?? 200;
  const sampling = options.sampling ?? 'balanced';

  if (sampling === 'influential' || sampling === 'recent') {
    const sort = sampling === 'influential' ? 'cited_by_count:desc' : 'publication_date:desc';
    const result = await fetchCitingPage(workId, limit, sort);
    options.onPage?.(result.works.length, result.total);
    return result;
  }

  const influentialBudget = Math.ceil(limit / 2);
  const influential = await fetchCitingPage(workId, influentialBudget, 'cited_by_count:desc');

  const seen = new Set(influential.works.map((w) => w.id));
  const recentBudget = limit - influential.works.length;
  const recent = recentBudget > 0
    ? await fetchCitingPage(workId, recentBudget + seen.size, 'publication_date:desc')
    : { works: [], total: influential.total };

  const merged = [...influential.works];
  for (const work of recent.works) {
    if (merged.length >= limit) break;
    if (seen.has(work.id)) continue;
    seen.add(work.id);
    merged.push(work);
  }

  const total = Math.max(influential.total, recent.total);
  options.onPage?.(merged.length, total);
  return { works: merged, total };
}

/**
 * Retracted works, newest notices first. Used to seed the crawl with real
 * flagged papers instead of a hardcoded DOI list.
 */
export async function fetchRetractedWorks(
  options: { limit?: number; minCitations?: number; fromYear?: number } = {},
): Promise<OpenAlexWork[]> {
  const limit = options.limit ?? 50;
  const filters = ['is_retracted:true'];
  if (options.minCitations) filters.push(`cited_by_count:>${options.minCitations}`);
  if (options.fromYear) filters.push(`from_publication_date:${options.fromYear}-01-01`);

  const works: OpenAlexWork[] = [];
  let cursor = '*';

  while (works.length < limit) {
    const url = new URL(`${base()}/works`);
    url.searchParams.set('filter', filters.join(','));
    url.searchParams.set('per-page', String(Math.min(200, limit - works.length)));
    url.searchParams.set('cursor', cursor);
    url.searchParams.set('select', WORK_FIELDS);
    // Highest-impact retractions first — those are the ones with a blast radius.
    url.searchParams.set('sort', 'cited_by_count:desc');

    const page = await fetchJson<OpenAlexPage<OpenAlexWork>>(withContact(url));
    if (!page?.results?.length) break;
    works.push(...page.results);
    const next = page.meta.next_cursor;
    if (!next) break;
    cursor = next;
  }

  return works.slice(0, limit);
}

/** Free-text search across titles and abstracts, for the search box. */
export async function searchWorks(
  query: string,
  limit = 20,
): Promise<OpenAlexWork[]> {
  const url = new URL(`${base()}/works`);
  url.searchParams.set('search', query);
  url.searchParams.set('per-page', String(Math.min(50, limit)));
  url.searchParams.set('select', WORK_FIELDS);
  const page = await fetchJson<OpenAlexPage<OpenAlexWork>>(withContact(url));
  return page?.results ?? [];
}

/** Look a work up by any identifier a user is likely to paste. */
export async function resolveIdentifier(raw: string): Promise<OpenAlexWork | null> {
  const input = raw.trim();
  if (!input) return null;

  const doi = normaliseDoi(input);
  if (doi) return fetchWorkByDoi(doi);

  if (/^W\d+$/i.test(input)) return fetchWorkById(input);
  if (/^https?:\/\/openalex\.org\/W\d+$/i.test(input)) return fetchWorkById(input);

  const pmid = /^(?:pmid:\s*)?(\d{6,9})$/i.exec(input);
  if (pmid) {
    const url = new URL(`${base()}/works/pmid:${pmid[1]}`);
    url.searchParams.set('select', WORK_FIELDS);
    return fetchJson<OpenAlexWork>(withContact(url), { nullOn404: true });
  }

  const arxiv = /^(?:arxiv:\s*)?(\d{4}\.\d{4,5})(v\d+)?$/i.exec(input);
  if (arxiv) {
    const url = new URL(`${base()}/works`);
    url.searchParams.set('filter', `doi:10.48550/arxiv.${arxiv[1]}`);
    url.searchParams.set('select', WORK_FIELDS);
    const page = await fetchJson<OpenAlexPage<OpenAlexWork>>(withContact(url));
    if (page?.results?.length) return page.results[0];
  }

  return null;
}

/** Map an OpenAlex work onto Geiger's own node shape. */
export function toPaperNode(work: OpenAlexWork, fetchedAt = new Date().toISOString()): PaperNode {
  const authors: Author[] = (work.authorships ?? [])
    .map((a) => ({
      id: a.author?.id,
      name: a.author?.display_name ?? '',
      orcid: a.author?.orcid ?? undefined,
    }))
    .filter((a) => a.name.length > 0);

  // OpenAlex's is_retracted is the floor, not the ceiling: the Crossref /
  // Retraction Watch enrichment pass upgrades and dates these.
  const status: IntegrityStatus = work.is_retracted ? 'retracted' : 'clean';

  return {
    id: work.id,
    doi: work.doi ? work.doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() : null,
    title: work.title ?? work.display_name ?? null,
    publicationYear: work.publication_year ?? null,
    publicationDate: work.publication_date ?? null,
    type: work.type ?? null,
    venue: work.primary_location?.source?.display_name ?? null,
    authors,
    concepts: (work.concepts ?? []).filter((c) => c.score > 0.3).map((c) => c.display_name),
    citedByCount: work.cited_by_count ?? 0,
    // referenced_works_count is the true reference-list length; the inlined
    // array can be shorter. Reliance weighting needs the real denominator.
    referencedCount: work.referenced_works_count ?? work.referenced_works?.length ?? 0,
    status,
    retracted: work.is_retracted,
    retraction: work.is_retracted
      ? { reasons: [], source: 'openalex' }
      : null,
    contamination: null,
    fetchedAt,
    sources: ['openalex'],
  };
}
