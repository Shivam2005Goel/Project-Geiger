/**
 * Shared presentation rules.
 *
 * Status and score appear in the graph, the table, the bibliography report and
 * the exports. Centralising the colours and the wording is what stops "red
 * means retracted" from quietly meaning something else on one screen.
 *
 * The language here is deliberate. A retraction is not an accusation of fraud —
 * a large share are honest error or author-initiated withdrawal — so nothing in
 * this file says "fraudulent", and the reason taxonomy is always shown rather
 * than collapsed into a verdict.
 */

import type { ContaminationAssessment, IntegrityStatus } from '../types';
import { bandFor, type ContaminationBand } from '../scoring/contamination';

export interface StatusPresentation {
  label: string;
  /** One line explaining what the status means, for tooltips and legends. */
  description: string;
  /** Tailwind classes for a badge. */
  badge: string;
  /** Graph node fill and stroke. */
  fill: string;
  stroke: string;
  /** Ordering for legends and sorts, most severe first. */
  rank: number;
}

export const STATUS: Record<IntegrityStatus, StatusPresentation> = {
  retracted: {
    label: 'Retracted',
    description: 'The publisher has withdrawn this paper. Reasons vary — see the notice.',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    fill: '#7f1d1d',
    stroke: '#f87171',
    rank: 0,
  },
  concerned: {
    label: 'Expression of concern',
    description: 'The publisher has flagged unresolved questions. Not a retraction.',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    fill: '#78350f',
    stroke: '#fbbf24',
    rank: 1,
  },
  corrected: {
    label: 'Corrected',
    description: 'A correction or erratum has been issued. The paper stands.',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    fill: '#0c4a6e',
    stroke: '#38bdf8',
    rank: 2,
  },
  clean: {
    label: 'No notice',
    description: 'No retraction, correction or expression of concern on record.',
    badge: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    fill: '#1e293b',
    stroke: '#64748b',
    rank: 3,
  },
};

export interface BandPresentation {
  label: string;
  description: string;
  badge: string;
  /** Node colour when the paper is clean but carries contamination. */
  fill: string;
  stroke: string;
}

export const BAND: Record<ContaminationBand, BandPresentation> = {
  source: {
    label: 'Flagged source',
    description: 'This paper is the origin of contamination, not a recipient of it.',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    fill: '#7f1d1d',
    stroke: '#f87171',
  },
  high: {
    label: 'High',
    description: 'Cites flagged work directly, often after the notice was published.',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    fill: '#7c2d12',
    stroke: '#fb923c',
  },
  moderate: {
    label: 'Moderate',
    description: 'Close to flagged work in the citation graph.',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    fill: '#713f12',
    stroke: '#facc15',
  },
  low: {
    label: 'Low',
    description: 'Two or more citation steps from flagged work.',
    badge: 'bg-yellow-500/10 text-yellow-200/80 border-yellow-500/20',
    fill: '#3f3f14',
    stroke: '#a3a30f',
  },
  trace: {
    label: 'Trace',
    description: 'A faint, heavily decayed connection to flagged work.',
    badge: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    fill: '#1e293b',
    stroke: '#475569',
  },
  none: {
    label: 'None detected',
    description: 'No path to flagged work was found within the corpus.',
    badge: 'bg-emerald-500/10 text-emerald-300/80 border-emerald-500/20',
    fill: '#134e4a',
    stroke: '#2dd4bf',
  },
};

/** The colour a graph node should be: status wins, then contamination band. */
export function nodeColours(
  status: IntegrityStatus,
  assessment: ContaminationAssessment | null,
): { fill: string; stroke: string } {
  if (status !== 'clean') {
    return { fill: STATUS[status].fill, stroke: STATUS[status].stroke };
  }
  const band = BAND[bandFor(assessment)];
  return { fill: band.fill, stroke: band.stroke };
}

/**
 * Node size from global citation count.
 *
 * Logarithmic because citation counts span five orders of magnitude; linear
 * sizing would render everything except the top few papers as identical dots.
 */
export function nodeSize(citedByCount: number): number {
  const base = 14;
  const scaled = Math.log10(Math.max(1, citedByCount)) * 8;
  return Math.round(Math.min(52, base + scaled));
}

/** Format a score for display, never implying more precision than exists. */
export function formatScore(assessment: ContaminationAssessment | null): string {
  if (!assessment) return '—';
  if (assessment.minHops === 0) return 'source';
  if (assessment.score === 0) return '0';
  return assessment.score.toFixed(1);
}

/**
 * A plain-language sentence explaining a score.
 *
 * Every place a number is shown, this goes next to it. A bare figure invites
 * over-reading; the sentence states what it is actually derived from.
 */
export function explainScore(assessment: ContaminationAssessment | null): string {
  if (!assessment) return 'Not yet assessed.';
  if (assessment.minHops === 0) {
    return 'This paper carries an integrity notice of its own.';
  }
  if (assessment.score === 0) {
    return 'No citation path to flagged work was found within the corpus.';
  }

  const parts: string[] = [];
  if (assessment.directHits > 0) {
    parts.push(
      `cites ${assessment.directHits} flagged ${assessment.directHits === 1 ? 'paper' : 'papers'} directly`,
    );
  }
  if (assessment.minHops !== null && assessment.minHops > 1) {
    parts.push(`nearest flagged work is ${assessment.minHops} citation steps away`);
  }
  if (assessment.postRetractionCitations > 0) {
    parts.push(
      `${assessment.postRetractionCitations} of those ${
        assessment.postRetractionCitations === 1 ? 'citation was' : 'citations were'
      } made after the notice was published`,
    );
  }
  if (assessment.totalUpstreamRetractions > 1) {
    parts.push(`${assessment.totalUpstreamRetractions} distinct flagged sources upstream`);
  }

  const body = parts.length ? parts.join('; ') : 'connected to flagged work in the citation graph';
  const caveat =
    assessment.citationIntent === 'disputing'
      ? ' Score reduced: this paper appears to discuss the retraction rather than rely on it.'
      : '';

  return `${body.charAt(0).toUpperCase()}${body.slice(1)}.${caveat}`;
}

export { bandFor };
export type { ContaminationBand };
