/**
 * Crossref client, used specifically to reach the Retraction Watch database.
 *
 * Retraction Watch has been CC0 and distributed through Crossref since 2023.
 * It is the authoritative source for *when* a paper was retracted and *why* —
 * neither of which OpenAlex carries. Since the entire timing half of the
 * contamination model depends on the notice date, this enrichment pass is not
 * optional garnish; without it every citation falls into the "unknown timing"
 * bucket.
 */

import { sources } from '../config';
import type { IntegrityStatus, RetractionRecord } from '../types';
import { fetchJson, requireContactEmail } from './http';

interface CrossrefDate {
  'date-parts'?: number[][];
  'date-time'?: string;
}

interface CrossrefUpdate {
  DOI?: string;
  type?: string;
  label?: string;
  source?: string;
  updated?: CrossrefDate;
}

interface CrossrefWork {
  DOI?: string;
  title?: string[];
  type?: string;
  'update-to'?: CrossrefUpdate[];
  updated_by?: CrossrefUpdate[];
  abstract?: string;
}

interface CrossrefEnvelope<T> {
  status: string;
  message: T;
}

interface CrossrefList {
  items: CrossrefWork[];
  'total-results': number;
}

function base(): string {
  return sources.crossrefBase.replace(/\/$/, '');
}

function withContact(url: URL): string {
  url.searchParams.set('mailto', requireContactEmail());
  return url.toString();
}

function isoDate(date?: CrossrefDate): string | null {
  if (!date) return null;
  if (date['date-time']) return date['date-time'].slice(0, 10);
  const parts = date['date-parts']?.[0];
  if (!parts?.length) return null;
  const [y, m = 1, d = 1] = parts;
  if (!y) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Map Crossref's update vocabulary onto Geiger's status ladder.
 *
 * The vocabulary is open-ended, so anything unrecognised that mentions
 * retraction or withdrawal is treated as a retraction rather than silently
 * dropped — under-reporting a retraction is the worse failure here.
 */
export function statusFromUpdateType(type: string | undefined): IntegrityStatus | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t.includes('retraction') || t.includes('withdraw') || t.includes('removal')) {
    return 'retracted';
  }
  if (t.includes('concern')) return 'concerned';
  if (t.includes('correction') || t.includes('erratum') || t.includes('corrigendum')) {
    return 'corrected';
  }
  return null;
}

const STATUS_SEVERITY: Record<IntegrityStatus, number> = {
  clean: 0,
  corrected: 1,
  concerned: 2,
  retracted: 3,
};

export interface RetractionLookup {
  status: IntegrityStatus;
  record: RetractionRecord | null;
}

/**
 * Derive integrity status from a Crossref work's `update-to` block.
 *
 * A paper can carry several notices over time — typically an expression of
 * concern followed by a full retraction. We keep the most severe, and date it
 * from that same notice so the timing weight refers to the right event.
 */
export function interpretUpdates(work: CrossrefWork): RetractionLookup {
  const updates = [...(work['update-to'] ?? []), ...(work.updated_by ?? [])];
  if (!updates.length) return { status: 'clean', record: null };

  let best: { status: IntegrityStatus; update: CrossrefUpdate } | null = null;

  for (const update of updates) {
    const status = statusFromUpdateType(update.type ?? update.label);
    if (!status) continue;
    if (!best || STATUS_SEVERITY[status] > STATUS_SEVERITY[best.status]) {
      best = { status, update };
    }
  }

  if (!best) return { status: 'clean', record: null };

  const noticeDate = isoDate(best.update.updated);
  return {
    status: best.status,
    record: {
      noticeDate: noticeDate ?? undefined,
      noticeYear: noticeDate ? Number(noticeDate.slice(0, 4)) : undefined,
      reasons: best.update.label ? [best.update.label] : [],
      nature: best.update.type,
      noticeUrl: best.update.DOI ? `https://doi.org/${best.update.DOI}` : undefined,
      source: best.update.source ?? 'crossref',
    },
  };
}

/** Look up retraction metadata for a single DOI. */
export async function fetchRetractionStatus(doi: string): Promise<RetractionLookup> {
  // No `select` here: Crossref supports field selection on /works list
  // queries but rejects it on the single-work endpoint with a 400.
  const url = new URL(`${base()}/works/${encodeURI(doi)}`);
  const envelope = await fetchJson<CrossrefEnvelope<CrossrefWork>>(withContact(url), {
    nullOn404: true,
  });
  if (!envelope?.message) return { status: 'clean', record: null };
  return interpretUpdates(envelope.message);
}

/**
 * Look up many DOIs at once.
 *
 * Crossref has no true batch endpoint, so this paces individual lookups
 * through the shared limiter rather than pretending to be cheaper than it is.
 * Failures are isolated: one bad DOI must not abandon the rest of a run.
 */
export async function fetchRetractionStatuses(
  dois: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, RetractionLookup>> {
  const results = new Map<string, RetractionLookup>();
  let done = 0;

  for (const doi of dois) {
    try {
      results.set(doi, await fetchRetractionStatus(doi));
    } catch {
      // Leave the DOI absent rather than recording a false "clean": a lookup
      // failure is not evidence that a paper is fine.
    }
    done += 1;
    onProgress?.(done, dois.length);
  }

  return results;
}

/**
 * Stream every retraction notice Crossref knows about.
 *
 * Used to build a local index so the ingest pipeline can flag papers without
 * a per-DOI round trip. Far cheaper than checking each paper individually
 * once the corpus is more than a few thousand works.
 */
export async function* streamRetractionNotices(
  options: { pageSize?: number; maxPages?: number } = {},
): AsyncGenerator<{ doi: string; status: IntegrityStatus; record: RetractionRecord }> {
  const pageSize = options.pageSize ?? 500;
  const maxPages = options.maxPages ?? Infinity;
  let cursor = '*';
  let pages = 0;

  while (pages < maxPages) {
    const url = new URL(`${base()}/works`);
    url.searchParams.set('filter', 'update-type:retraction,update-type:expression_of_concern');
    url.searchParams.set('rows', String(pageSize));
    url.searchParams.set('cursor', cursor);
    url.searchParams.set('select', 'DOI,update-to');

    const envelope = await fetchJson<
      CrossrefEnvelope<CrossrefList & { 'next-cursor'?: string }>
    >(withContact(url));
    const items = envelope?.message?.items ?? [];
    if (!items.length) return;

    for (const item of items) {
      if (!item.DOI) continue;
      const { status, record } = interpretUpdates(item);
      if (status !== 'clean' && record) {
        yield { doi: item.DOI.toLowerCase(), status, record };
      }
    }

    const next = envelope?.message?.['next-cursor'];
    if (!next || next === cursor) return;
    cursor = next;
    pages += 1;
  }
}
