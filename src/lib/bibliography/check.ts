/**
 * The bibliography check.
 *
 * This is the question researchers actually have, and it is not "show me a
 * pretty graph": it is *"is there a retracted paper in my reference list, and
 * does anything I cite quietly rest on one?"*
 *
 * Two levels of answer, because the second is the one people cannot get
 * anywhere else:
 *
 *   direct   — this reference is itself retracted or under concern.
 *   indirect — this reference is fine, but its own references include flagged
 *              work, so the claim you are leaning on may not hold.
 */

import { limits } from '../config';
import { findFlaggedReferences, lookupDois } from '../db/queries/search';
import { fetchWorkByDoi, normaliseDoi, toPaperNode } from '../sources/openalex';
import { fetchRetractionStatus } from '../sources/crossref';
import { mergeIntegrity } from '../sources/merge';
import { bandFor } from '../scoring/contamination';
import type {
  BibliographyFinding,
  BibliographyReport,
  IntegrityStatus,
  PaperNode,
} from '../types';
import { SCORE_VERSION } from '../config';
import type { ParsedEntry } from './parse';

export interface CheckOptions {
  /**
   * Look up references we do not already hold against OpenAlex and Crossref.
   * Slower, but the difference between "we have no record" and "we checked".
   */
  resolveRemote?: boolean;
  /** Cap on remote lookups, so one huge upload cannot run for an hour. */
  maxRemote?: number;
  onProgress?: (done: number, total: number) => void;
}

const NOTE_BY_STATUS: Record<Exclude<IntegrityStatus, 'clean'>, string> = {
  retracted: 'This reference has been retracted.',
  concerned: 'This reference carries an expression of concern.',
  corrected: 'This reference has been formally corrected.',
};

/**
 * Check a parsed bibliography.
 *
 * Resolves everything it can locally in one round trip, then optionally fills
 * gaps from upstream. Entries that cannot be resolved are reported as
 * unresolved rather than clean — silence is not an all-clear, and a checker
 * that quietly reports unknown references as fine is worse than no checker.
 */
export async function checkBibliography(
  entries: ParsedEntry[],
  options: CheckOptions = {},
): Promise<BibliographyReport> {
  const capped = entries.slice(0, limits.maxBibliographyEntries);
  const dois = capped
    .map((e) => (e.doi ? normaliseDoi(e.doi) : null))
    .filter((d): d is string => d !== null);

  const local = await lookupDois(dois);

  // Papers we know about get an indirect check too: what do *they* cite?
  const knownIds = [...local.values()].map((p) => p.id);
  const flaggedRefs = await findFlaggedReferences(knownIds);

  const remote = new Map<string, PaperNode>();
  if (options.resolveRemote) {
    const missing = dois.filter((d) => !local.has(d));
    const budget = Math.min(missing.length, options.maxRemote ?? 200);
    await resolveRemotely(missing.slice(0, budget), remote, options.onProgress);
  }

  const findings: BibliographyFinding[] = capped.map((entry) => {
    const doi = entry.doi ? normaliseDoi(entry.doi) : null;

    if (!doi) {
      return {
        input: entry.raw.slice(0, 300),
        doi: null,
        resolved: false,
        paper: null,
        status: 'clean',
        contaminationScore: null,
        inheritedFrom: [],
        note: 'No DOI found in this entry, so it could not be checked.',
      };
    }

    const paper = local.get(doi) ?? remote.get(doi) ?? null;

    if (!paper) {
      return {
        input: entry.raw.slice(0, 300),
        doi,
        resolved: false,
        paper: null,
        status: 'clean',
        contaminationScore: null,
        inheritedFrom: [],
        note: options.resolveRemote
          ? 'Not found in our corpus or in OpenAlex. Verify this DOI manually.'
          : 'Not yet in our corpus. Re-run with deep checking to look it up.',
      };
    }

    const inherited = (flaggedRefs.get(paper.id) ?? []).map((ref) => ({
      id: ref.id,
      title: ref.title,
      doi: ref.doi,
    }));

    return {
      input: entry.raw.slice(0, 300),
      doi,
      resolved: true,
      paper,
      status: paper.status,
      contaminationScore: paper.contamination?.score ?? null,
      inheritedFrom: inherited,
      note: noteFor(paper, inherited.length),
    };
  });

  return {
    findings,
    summary: summarise(findings),
    generatedAt: new Date().toISOString(),
    scoreVersion: SCORE_VERSION,
  };
}

function noteFor(paper: PaperNode, inheritedCount: number): string | null {
  if (paper.status !== 'clean') {
    const base = NOTE_BY_STATUS[paper.status];
    const when = paper.retraction?.noticeDate
      ? ` Notice issued ${paper.retraction.noticeDate}.`
      : '';
    const why = paper.retraction?.reasons.length
      ? ` Reason: ${paper.retraction.reasons.join('; ')}.`
      : '';
    return `${base}${when}${why}`;
  }

  if (inheritedCount > 0) {
    return `This reference is not itself flagged, but ${inheritedCount} of its own ` +
      `references ${inheritedCount === 1 ? 'is' : 'are'} — the claim you are citing may rest on them.`;
  }

  const band = bandFor(paper.contamination);
  if (band === 'high' || band === 'moderate') {
    return 'This reference sits close to flagged work in the citation graph.';
  }

  return null;
}

function summarise(findings: BibliographyFinding[]): BibliographyReport['summary'] {
  const resolved = findings.filter((f) => f.resolved);
  return {
    total: findings.length,
    resolved: resolved.length,
    unresolved: findings.length - resolved.length,
    retracted: resolved.filter((f) => f.status === 'retracted').length,
    concerned: resolved.filter((f) => f.status === 'concerned').length,
    corrected: resolved.filter((f) => f.status === 'corrected').length,
    contaminated: resolved.filter(
      (f) => f.status === 'clean' && (f.inheritedFrom.length > 0 || (f.contaminationScore ?? 0) > 0),
    ).length,
    clean: resolved.filter(
      (f) => f.status === 'clean' && f.inheritedFrom.length === 0 && (f.contaminationScore ?? 0) === 0,
    ).length,
  };
}

/**
 * Resolve unknown DOIs upstream.
 *
 * OpenAlex is asked in batches of 50; Crossref is then consulted for each
 * result that OpenAlex thinks is clean, because Retraction Watch routinely
 * knows about retractions OpenAlex has not yet flagged — which is the entire
 * reason this pass exists.
 */
async function resolveRemotely(
  dois: string[],
  into: Map<string, PaperNode>,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (!dois.length) return;

  // OpenAlex has no bulk DOI filter that behaves well, so resolve per DOI but
  // reuse the paced HTTP client, then batch-hydrate what we found.
  let done = 0;

  for (const doi of dois) {
    try {
      const work = await fetchWorkByDoi(doi);
      if (work) into.set(doi, toPaperNode(work));
    } catch {
      // Leave it unresolved; the report says so explicitly.
    }
    done += 1;
    onProgress?.(done, dois.length);
  }

  // Second opinion from Crossref for anything OpenAlex called clean.
  for (const [doi, paper] of into) {
    if (paper.status !== 'clean') continue;
    try {
      const lookup = await fetchRetractionStatus(doi);
      if (lookup.status === 'clean') continue;
      const merged = mergeIntegrity({ status: paper.status, record: paper.retraction }, lookup);
      into.set(doi, {
        ...paper,
        status: merged.status,
        retracted: merged.status === 'retracted',
        retraction: merged.record,
        sources: [...new Set([...paper.sources, 'crossref'])],
      });
    } catch {
      // Keep the OpenAlex reading.
    }
  }
}
