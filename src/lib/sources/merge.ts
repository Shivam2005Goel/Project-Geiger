/**
 * Reconciling integrity signals from more than one source.
 *
 * No single source is complete. OpenAlex carries a retraction flag but no
 * dates; Crossref/Retraction Watch carries dated notices but lags, and often
 * holds an earlier expression of concern without the later retraction. The
 * Lesné 2006 paper is the canonical example: OpenAlex knows it was retracted,
 * Crossref only has the 2022 expression of concern.
 *
 * Two rules follow, and they pull in different directions on purpose:
 *
 *   status — take the MOST SEVERE assertion from any source. A source that has
 *            not caught up is silent, not exculpatory.
 *   date   — take the EARLIEST notice of any severity. What the timing weight
 *            actually asks is "was there a public warning when this citation
 *            was made?", and an expression of concern is such a warning.
 */

import type { IntegrityStatus, RetractionRecord } from '../types';

export const STATUS_SEVERITY: Record<IntegrityStatus, number> = {
  clean: 0,
  corrected: 1,
  concerned: 2,
  retracted: 3,
};

export function mostSevere(...statuses: (IntegrityStatus | null | undefined)[]): IntegrityStatus {
  let best: IntegrityStatus = 'clean';
  for (const status of statuses) {
    if (!status) continue;
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[best]) best = status;
  }
  return best;
}

export interface MergedIntegrity {
  status: IntegrityStatus;
  record: RetractionRecord | null;
  /** True when sources disagreed and we kept the more severe reading. */
  conflicted: boolean;
}

/**
 * Merge an existing stored assessment with a freshly fetched one.
 *
 * Never downgrades. A source returning "clean" means it has no record, which
 * is not evidence that another source's flag is wrong.
 */
export function mergeIntegrity(
  existing: { status: IntegrityStatus; record: RetractionRecord | null },
  incoming: { status: IntegrityStatus; record: RetractionRecord | null },
): MergedIntegrity {
  const status = mostSevere(existing.status, incoming.status);
  const conflicted =
    existing.status !== 'clean' &&
    incoming.status !== 'clean' &&
    existing.status !== incoming.status;

  if (status === 'clean') {
    return { status, record: null, conflicted: false };
  }

  const dates = [existing.record?.noticeDate, incoming.record?.noticeDate].filter(
    (d): d is string => typeof d === 'string' && d.length >= 4,
  );
  // Earliest, because the question is when the community was first warned.
  const noticeDate = dates.length ? dates.sort()[0] : undefined;

  // Prefer the description attached to the source that asserted the severest
  // status, so a "Retraction" is not labelled "Expression of concern".
  const primary =
    STATUS_SEVERITY[incoming.status] >= STATUS_SEVERITY[existing.status]
      ? incoming.record
      : existing.record;
  const secondary = primary === incoming.record ? existing.record : incoming.record;

  const reasons = [
    ...new Set([...(primary?.reasons ?? []), ...(secondary?.reasons ?? [])]),
  ];

  const sources = [primary?.source, secondary?.source].filter(Boolean).join('+');

  return {
    status,
    record: {
      noticeDate,
      noticeYear: noticeDate ? Number(noticeDate.slice(0, 4)) : undefined,
      reasons,
      nature: primary?.nature ?? secondary?.nature,
      noticeUrl: primary?.noticeUrl ?? secondary?.noticeUrl,
      source: sources || undefined,
    },
    conflicted,
  };
}
