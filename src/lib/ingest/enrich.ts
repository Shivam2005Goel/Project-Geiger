/**
 * Retraction enrichment.
 *
 * OpenAlex's `is_retracted` tells you *that* a paper was retracted but never
 * *when* or *why*. Both halves matter here: the notice date is the pivot the
 * timing weight turns on, and the reason is what keeps the interface honest
 * about the difference between fraud and an honest error.
 *
 * Retraction Watch has been CC0 through Crossref since 2023, and it is also
 * broader than OpenAlex's flag — papers show up here that OpenAlex still has
 * marked clean.
 */

import { fetchRetractionStatus } from '../sources/crossref';
import { mergeIntegrity } from '../sources/merge';
import { int, toNumber, withRead, withWrite } from '../db/driver';
import type { IntegrityStatus } from '../types';

const BATCH = 200;

export interface EnrichSummary {
  checked: number;
  updated: number;
  newlyFlagged: number;
  datesAdded: number;
  /** Papers where sources disagreed and the severer reading was kept. */
  conflicted: number;
  failed: number;
}

interface Candidate {
  id: string;
  doi: string;
  status: IntegrityStatus;
  hasDate: boolean;
  noticeDate: string | null;
}

/**
 * Papers worth asking Crossref about.
 *
 * Prioritises papers already flagged but missing a notice date, since those
 * are the ones actively degrading score quality — every one of them forces a
 * citation into the "unknown timing" bucket.
 */
async function candidates(limit: number, recheckAll: boolean): Promise<Candidate[]> {
  return withRead(async (session) => {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (p:Paper)
        WHERE p.doi IS NOT NULL
          AND ($recheckAll OR p.retractionCheckedAt IS NULL
               OR (p.status <> 'clean' AND p.retractionDate IS NULL))
        RETURN p.openalexId AS id,
               p.doi AS doi,
               coalesce(p.status, 'clean') AS status,
               p.retractionDate IS NOT NULL AS hasDate,
               p.retractionDate AS noticeDate
        ORDER BY CASE WHEN coalesce(p.status,'clean') <> 'clean'
                       AND p.retractionDate IS NULL THEN 0 ELSE 1 END,
                 coalesce(p.citedByCount, 0) DESC
        LIMIT $limit
        `,
        { limit: int(limit), recheckAll },
      ),
    );

    return result.records.map((r) => ({
      id: r.get('id'),
      doi: r.get('doi'),
      status: r.get('status') as IntegrityStatus,
      hasDate: r.get('hasDate') === true,
      noticeDate: r.get('noticeDate') ?? null,
    }));
  });
}

export async function enrichRetractions(
  options: {
    limit?: number;
    recheckAll?: boolean;
    onProgress?: (done: number, total: number, message: string) => void;
  } = {},
): Promise<EnrichSummary> {
  const limit = options.limit ?? 1000;
  const log = options.onProgress ?? (() => {});
  const targets = await candidates(limit, options.recheckAll ?? false);

  const summary: EnrichSummary = {
    checked: 0, updated: 0, newlyFlagged: 0, datesAdded: 0, conflicted: 0, failed: 0,
  };

  const pending: Record<string, unknown>[] = [];
  const checkedAt = new Date().toISOString();

  const flush = async () => {
    if (!pending.length) return;
    await withWrite(async (session) => {
      await session.executeWrite((tx) =>
        tx.run(
          `
          UNWIND $rows AS row
          MATCH (p:Paper {openalexId: row.id})
          SET p.status = row.status,
              p.retracted = row.status = 'retracted',
              p.retractionDate = row.retractionDate,
              p.retractionYear = row.retractionYear,
              p.retractionReasons = row.retractionReasons,
              p.retractionNature = row.retractionNature,
              p.retractionNoticeUrl = row.retractionNoticeUrl,
              p.retractionSource = row.retractionSource,
              p.retractionCheckedAt = row.checkedAt,
              p.sources = CASE
                WHEN 'crossref' IN coalesce(p.sources, []) THEN p.sources
                ELSE coalesce(p.sources, []) + 'crossref'
              END
          `,
          { rows: pending },
        ),
      );
    });
    pending.length = 0;
  };

  for (const target of targets) {
    summary.checked += 1;
    try {
      const lookup = await fetchRetractionStatus(target.doi);

      // Reconcile rather than overwrite. Crossref frequently holds only an
      // earlier expression of concern for a paper OpenAlex already knows was
      // retracted; taking the newer answer at face value would quietly
      // unretract it.
      const merged = mergeIntegrity(
        {
          status: target.status,
          record: target.noticeDate
            ? { noticeDate: target.noticeDate, reasons: [], source: 'existing' }
            : target.status !== 'clean'
              ? { reasons: [], source: 'existing' }
              : null,
        },
        lookup,
      );

      const gainedDate = Boolean(merged.record?.noticeDate) && !target.hasDate;
      if (merged.status !== target.status || gainedDate) {
        summary.updated += 1;
        if (target.status === 'clean' && merged.status !== 'clean') summary.newlyFlagged += 1;
        if (gainedDate) summary.datesAdded += 1;
      }
      if (merged.conflicted) summary.conflicted += 1;

      pending.push({
        id: target.id,
        status: merged.status,
        retractionDate: merged.record?.noticeDate ?? null,
        retractionYear: merged.record?.noticeYear ?? null,
        retractionReasons: merged.record?.reasons ?? [],
        retractionNature: merged.record?.nature ?? null,
        retractionNoticeUrl: merged.record?.noticeUrl ?? null,
        retractionSource: merged.record?.source ?? null,
        checkedAt,
      });
    } catch {
      // A failed lookup must not be recorded as "checked and clean" — leave
      // the paper unmarked so the next run retries it.
      summary.failed += 1;
    }

    if (pending.length >= BATCH) await flush();
    if (summary.checked % 25 === 0) {
      log(summary.checked, targets.length, `${summary.updated} updated, ${summary.failed} failed`);
    }
  }

  await flush();
  return summary;
}

/** How much of the corpus has usable retraction dating. */
export async function retractionCoverage(): Promise<{
  flagged: number;
  withDates: number;
  checked: number;
  total: number;
}> {
  return withRead(async (session) => {
    const result = await session.executeRead((tx) =>
      tx.run(`
        MATCH (p:Paper)
        RETURN count(p) AS total,
               sum(CASE WHEN coalesce(p.status,'clean') <> 'clean' THEN 1 ELSE 0 END) AS flagged,
               sum(CASE WHEN p.retractionDate IS NOT NULL THEN 1 ELSE 0 END) AS withDates,
               sum(CASE WHEN p.retractionCheckedAt IS NOT NULL THEN 1 ELSE 0 END) AS checked
      `),
    );
    const r = result.records[0];
    return {
      total: toNumber(r.get('total')) ?? 0,
      flagged: toNumber(r.get('flagged')) ?? 0,
      withDates: toNumber(r.get('withDates')) ?? 0,
      checked: toNumber(r.get('checked')) ?? 0,
    };
  });
}
