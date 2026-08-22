/**
 * The contamination model.
 *
 * Everything in this file is pure: it takes papers and citation edges in and
 * returns assessments out, with no database, network or clock access beyond an
 * injectable timestamp. That is deliberate — this is the one part of Geiger
 * whose output people are asked to trust, so it has to be testable in
 * isolation and readable by someone auditing the method.
 *
 * The model in one sentence: dose flows backwards along citations from flagged
 * papers to the papers that cite them, decaying each hop, weighted by whether
 * the citing work appeared after the retraction notice and by how heavily it
 * leans on any single reference.
 *
 *   score(p) = normalise( Σ_r severity(r) · w_time(p,r) · w_reliance(p) · w_intent · decay^(hops−1) )
 *
 * See `scoring` in `src/lib/config.ts` for the coefficients, and the /methods
 * page in the app for the prose description.
 */

import { scoring, SCORE_VERSION } from '../config';
import type { ContaminationAssessment, IntegrityStatus } from '../types';

export type CitationIntent = 'supporting' | 'mentioning' | 'disputing';

/** The minimum a paper must expose for the model to score it. */
export interface ScoringPaper {
  id: string;
  status: IntegrityStatus;
  /** ISO YYYY-MM-DD when available; falls back to publicationYear. */
  publicationDate?: string | null;
  publicationYear?: number | null;
  /** Length of this paper's reference list. Drives reliance weighting. */
  referencedCount?: number | null;
  /** ISO date of this paper's own retraction notice, if it has one. */
  retractionDate?: string | null;
  retractionYear?: number | null;
}

/** A citation, always in the direction citing to cited. */
export interface ScoringEdge {
  source: string;
  target: string;
  intent?: CitationIntent | null;
}

export interface ScoringParams {
  hopDecay: number;
  maxGenerations: number;
  weightPostRetraction: number;
  weightPreRetraction: number;
  weightUnknownTiming: number;
  referenceBaseline: number;
  doseHalfSaturation: number;
  sourceSeverity: Record<string, number>;
  intentWeights: Record<CitationIntent, number>;
}

export const DEFAULT_PARAMS: ScoringParams = {
  hopDecay: scoring.hopDecay,
  maxGenerations: scoring.maxGenerations,
  weightPostRetraction: scoring.weightPostRetraction,
  weightPreRetraction: scoring.weightPreRetraction,
  weightUnknownTiming: scoring.weightUnknownTiming,
  referenceBaseline: scoring.referenceBaseline,
  doseHalfSaturation: scoring.doseHalfSaturation,
  sourceSeverity: { ...scoring.sourceSeverity },
  intentWeights: { ...scoring.intentWeights },
};

/** Relative ordering of two partially-known dates. */
export type Ordering = 'before' | 'after' | 'unknown';

/**
 * Compare a publication date against a retraction notice date, tolerating the
 * fact that one or both may be a bare year or missing entirely.
 *
 * Same-year comparisons return 'unknown' rather than guessing: a paper
 * published in March cannot be judged against a notice issued in some unknown
 * month of the same year.
 */
export function compareToNotice(
  publication: { date?: string | null; year?: number | null },
  notice: { date?: string | null; year?: number | null },
): Ordering {
  const pubFull = fullDate(publication.date);
  const noticeFull = fullDate(notice.date);

  if (pubFull && noticeFull) {
    if (pubFull === noticeFull) return 'unknown';
    return pubFull > noticeFull ? 'after' : 'before';
  }

  const pubYear = publication.year ?? yearOf(publication.date);
  const noticeYear = notice.year ?? yearOf(notice.date);
  if (pubYear == null || noticeYear == null) return 'unknown';
  if (pubYear === noticeYear) return 'unknown';
  return pubYear > noticeYear ? 'after' : 'before';
}

function fullDate(value?: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function yearOf(value?: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{4})/.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * How much weight a citation carries given when it happened relative to the
 * retraction notice.
 *
 * A paper published before the notice could not have known; one published
 * after either missed the notice or ignored it, and that is the signal the
 * whole tool exists to surface.
 */
export function timingWeight(
  citing: ScoringPaper,
  flagged: ScoringPaper,
  params: ScoringParams = DEFAULT_PARAMS,
): number {
  const ordering = compareToNotice(
    { date: citing.publicationDate, year: citing.publicationYear },
    { date: flagged.retractionDate, year: flagged.retractionYear },
  );
  if (ordering === 'after') return params.weightPostRetraction;
  if (ordering === 'before') return params.weightPreRetraction;
  return params.weightUnknownTiming;
}

/**
 * How heavily a paper leans on any one of its references.
 *
 * Citing a retracted work among eight references is a materially different act
 * from citing it among three hundred. Falls off as baseline/count above the
 * baseline and is capped at 1 below it, so the weight always sits in (0, 1].
 */
export function relianceWeight(
  referencedCount: number | null | undefined,
  params: ScoringParams = DEFAULT_PARAMS,
): number {
  const baseline = params.referenceBaseline;
  if (baseline <= 0) return 1;
  const count = referencedCount ?? 0;
  if (count <= baseline) return 1;
  return baseline / count;
}

/** Dose emitted by a flagged paper, by status. Clean papers emit nothing. */
export function severityWeight(
  status: IntegrityStatus,
  params: ScoringParams = DEFAULT_PARAMS,
): number {
  return params.sourceSeverity[status] ?? 0;
}

export function intentWeight(
  intent: CitationIntent | null | undefined,
  params: ScoringParams = DEFAULT_PARAMS,
): number {
  if (!intent) return 1;
  return params.intentWeights[intent] ?? 1;
}

/**
 * Map an unbounded accumulated dose onto a 0-100 scale.
 *
 * Saturating rather than linear so that a paper citing twenty retracted works
 * does not produce a number twenty times larger than one citing a single work
 * — past a point, "heavily contaminated" is the whole message.
 */
export function normaliseDose(
  dose: number,
  params: ScoringParams = DEFAULT_PARAMS,
): number {
  if (dose <= 0) return 0;
  const saturation = params.doseHalfSaturation;
  if (saturation <= 0) return 100;
  const value = 100 * (1 - Math.exp(-dose / saturation));
  return Math.round(value * 10) / 10;
}

/** Per-paper accumulator used while propagating. */
interface Accumulator {
  dose: number;
  directHits: number;
  upstream: Set<string>;
  minHops: number;
  postRetractionCitations: number;
}

export interface ScoreGraphOptions {
  params?: ScoringParams;
  /** Injectable so tests and batch runs get deterministic timestamps. */
  now?: () => Date;
  version?: string;
}

/**
 * Score every paper in a citation graph.
 *
 * Runs one breadth-first sweep per flagged paper, walking backwards along
 * citations — from the flagged work to the papers that cite it. Because dose
 * decays monotonically with hop count and no other term depends on distance,
 * the first time BFS reaches a paper it has already found that paper's
 * maximum contribution from this source, so there is no need to enumerate
 * every path.
 *
 * Complexity is O(flagged x edges) in the worst case, which is fine for batch
 * scoring after ingest and is why scores are precomputed rather than derived
 * per request.
 */
export function scoreGraph(
  papers: ScoringPaper[],
  edges: ScoringEdge[],
  options: ScoreGraphOptions = {},
): Map<string, ContaminationAssessment> {
  const params = options.params ?? DEFAULT_PARAMS;
  const version = options.version ?? SCORE_VERSION;
  const computedAt = (options.now ?? (() => new Date()))().toISOString();

  const byId = new Map<string, ScoringPaper>();
  for (const paper of papers) byId.set(paper.id, paper);

  // citedId -> citations pointing at it. This is the propagation direction:
  // dose travels from a cited paper out to everyone who cited it.
  const citers = new Map<string, ScoringEdge[]>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const list = citers.get(edge.target);
    if (list) list.push(edge);
    else citers.set(edge.target, [edge]);
  }

  // Intent is a property of the citing paper, so every edge leaving a paper
  // carries the same value. Recording it lets the result explain why a score
  // was reduced without the caller re-deriving the classification.
  const intentByPaper = new Map<string, CitationIntent | null>();
  for (const edge of edges) {
    if (edge.intent && !intentByPaper.has(edge.source)) {
      intentByPaper.set(edge.source, edge.intent);
    }
  }

  const accumulators = new Map<string, Accumulator>();
  const accumulatorFor = (id: string): Accumulator => {
    let acc = accumulators.get(id);
    if (!acc) {
      acc = {
        dose: 0,
        directHits: 0,
        upstream: new Set(),
        minHops: Number.POSITIVE_INFINITY,
        postRetractionCitations: 0,
      };
      accumulators.set(id, acc);
    }
    return acc;
  };

  const flagged = papers.filter((p) => severityWeight(p.status, params) > 0);

  for (const source of flagged) {
    const severity = severityWeight(source.status, params);

    // Distance from `source` at which BFS first reached each paper.
    const reachedAt = new Map<string, number>([[source.id, 0]]);
    let frontier: ScoringEdge[] = citers.get(source.id) ?? [];
    let hop = 1;

    while (hop <= params.maxGenerations && frontier.length > 0) {
      const nextFrontier: ScoringEdge[] = [];

      for (const edge of frontier) {
        const citing = byId.get(edge.source);
        if (!citing) continue;
        // Already reached on an equal or shorter path, which by monotonic
        // decay already carries at least this much dose.
        if (reachedAt.has(citing.id)) continue;
        reachedAt.set(citing.id, hop);

        const contribution =
          severity *
          timingWeight(citing, source, params) *
          relianceWeight(citing.referencedCount, params) *
          intentWeight(edge.intent, params) *
          Math.pow(params.hopDecay, hop - 1);

        const acc = accumulatorFor(citing.id);
        acc.dose += contribution;
        acc.upstream.add(source.id);
        if (hop < acc.minHops) acc.minHops = hop;
        if (hop === 1) {
          acc.directHits += 1;
          const ordering = compareToNotice(
            { date: citing.publicationDate, year: citing.publicationYear },
            { date: source.retractionDate, year: source.retractionYear },
          );
          if (ordering === 'after') acc.postRetractionCitations += 1;
        }

        const onward = citers.get(citing.id);
        if (onward && hop < params.maxGenerations) nextFrontier.push(...onward);
      }

      frontier = nextFrontier;
      hop += 1;
    }
  }

  const results = new Map<string, ContaminationAssessment>();
  for (const paper of papers) {
    const acc = accumulators.get(paper.id);
    const isFlagged = severityWeight(paper.status, params) > 0;

    // A paper that is itself retracted is not "contaminated by" anything — it
    // is the source. Pinning it to 100 keeps the scale honest and stops a
    // retracted paper with no upstream from reading as clean.
    if (paper.status === 'retracted') {
      results.set(paper.id, {
        score: 100,
        dose: acc ? Math.round(acc.dose * 10000) / 10000 : 0,
        directHits: acc?.directHits ?? 0,
        totalUpstreamRetractions: acc?.upstream.size ?? 0,
        minHops: 0,
        postRetractionCitations: acc?.postRetractionCitations ?? 0,
        version,
        computedAt,
        citationIntent: intentByPaper.get(paper.id) ?? null,
        intentReason: null,
      });
      continue;
    }

    if (!acc) {
      results.set(paper.id, {
        score: 0,
        dose: 0,
        directHits: 0,
        totalUpstreamRetractions: 0,
        minHops: isFlagged ? 0 : null,
        postRetractionCitations: 0,
        version,
        computedAt,
        citationIntent: intentByPaper.get(paper.id) ?? null,
        intentReason: null,
      });
      continue;
    }

    results.set(paper.id, {
      score: normaliseDose(acc.dose, params),
      dose: Math.round(acc.dose * 10000) / 10000,
      directHits: acc.directHits,
      totalUpstreamRetractions: acc.upstream.size,
      minHops: Number.isFinite(acc.minHops) ? acc.minHops : null,
      postRetractionCitations: acc.postRetractionCitations,
      version,
      computedAt,
      citationIntent: intentByPaper.get(paper.id) ?? null,
      intentReason: null,
    });
  }

  return results;
}

/**
 * Enumerate the actual citation chains that produced a paper's score.
 *
 * This is the "show your working" query. It is separate from `scoreGraph`
 * because enumerating paths is combinatorial and only ever wanted for one
 * paper at a time, on demand.
 */
export function explainPaths(
  target: string,
  papers: ScoringPaper[],
  edges: ScoringEdge[],
  options: ScoreGraphOptions & { maxPaths?: number } = {},
): { nodeIds: string[]; hops: number; contribution: number; postRetraction: boolean }[] {
  const params = options.params ?? DEFAULT_PARAMS;
  const maxPaths = options.maxPaths ?? 25;

  const byId = new Map<string, ScoringPaper>();
  for (const paper of papers) byId.set(paper.id, paper);

  // Walk from the target back down its own references, looking for flagged work.
  const cited = new Map<string, ScoringEdge[]>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const list = cited.get(edge.source);
    if (list) list.push(edge);
    else cited.set(edge.source, [edge]);
  }

  const found: { nodeIds: string[]; hops: number; contribution: number; postRetraction: boolean }[] = [];
  const start = byId.get(target);
  if (!start) return found;

  const walk = (current: string, trail: string[], depth: number) => {
    if (found.length >= maxPaths) return;
    if (depth > params.maxGenerations) return;

    for (const edge of cited.get(current) ?? []) {
      if (trail.includes(edge.target)) continue; // no cycles
      const next = byId.get(edge.target);
      if (!next) continue;

      const nextTrail = [...trail, edge.target];
      const severity = severityWeight(next.status, params);

      if (severity > 0) {
        const hops = depth + 1;
        const contribution =
          severity *
          timingWeight(start, next, params) *
          relianceWeight(start.referencedCount, params) *
          intentWeight(edge.intent, params) *
          Math.pow(params.hopDecay, hops - 1);
        const ordering = compareToNotice(
          { date: start.publicationDate, year: start.publicationYear },
          { date: next.retractionDate, year: next.retractionYear },
        );
        found.push({
          // Reported source-first: retracted work leads, affected paper last.
          nodeIds: [...nextTrail].reverse(),
          hops,
          contribution: Math.round(contribution * 10000) / 10000,
          postRetraction: ordering === 'after',
        });
        if (found.length >= maxPaths) return;
        continue; // stop at the first flagged ancestor on this branch
      }

      walk(edge.target, nextTrail, depth + 1);
    }
  };

  walk(target, [target], 0);
  found.sort((a, b) => b.contribution - a.contribution);
  return found.slice(0, maxPaths);
}

/**
 * Human-readable band for a score. The UI shows the band alongside the number
 * so a reader who should not over-interpret one decimal place does not.
 */
export type ContaminationBand = 'none' | 'trace' | 'low' | 'moderate' | 'high' | 'source';

export function bandFor(assessment: ContaminationAssessment | null): ContaminationBand {
  if (!assessment) return 'none';
  if (assessment.minHops === 0) return 'source';
  const s = assessment.score;
  if (s <= 0) return 'none';
  if (s < 10) return 'trace';
  if (s < 30) return 'low';
  if (s < 60) return 'moderate';
  return 'high';
}

export const BAND_LABELS: Record<ContaminationBand, string> = {
  none: 'No detected contamination',
  trace: 'Trace',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  source: 'Flagged paper',
};
