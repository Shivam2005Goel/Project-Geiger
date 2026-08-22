/**
 * Citation-intent heuristics.
 *
 * The problem this solves is not hypothetical. Run the model over the Lesné
 * 2006 neighbourhood without it and the highest-scoring "contaminated" papers
 * include:
 *
 *   - "Academic Research Integrity Investigations Must be Independent, Fair..."
 *   - "Doctored: Fraud, Arrogance, and Tragedy in the Quest to Cure Alzheimer's"
 *   - "Performance of AI Tools in Citing Retracted Literature"
 *
 * Every one of those cites the retracted paper *as an example of misconduct*.
 * Scoring them as contaminated is not a rounding error, it is the tool getting
 * the answer exactly backwards and penalising the people doing the correcting.
 *
 * The right fix is full citation-context classification over the citing
 * sentence. That needs full text, which needs Unpaywall plus a PDF parser, and
 * is a project in itself. What follows is a deliberately conservative stand-in
 * that catches the clearest cases from metadata alone.
 *
 * KNOWN LIMITS — these are stated in the UI, not hidden here:
 *   - Metadata only. A paper that discusses the retraction in its body but not
 *     its title is not caught.
 *   - English only.
 *   - A paper can both critique the fraud and rest on adjacent claims.
 *   - It cannot see which of several references a phrase refers to.
 *
 * Because of that, a match lowers a score but never zeroes it, and the
 * classification travels with the result so a reader can disagree with it.
 */

import type { CitationIntent } from './contamination';

/**
 * Title patterns that indicate meta-research: work *about* research integrity
 * rather than work building on a scientific claim.
 *
 * Kept narrow on purpose. "Review" and "comment" are excluded because a review
 * article usually does rest on the literature it reviews.
 */
const META_RESEARCH_PATTERNS: RegExp[] = [
  /\bretract(ed|ion|ions)\b/i,
  /\bresearch integrity\b/i,
  /\bscientific (misconduct|fraud|integrity)\b/i,
  /\b(data|image) (manipulation|fabrication|falsification)\b/i,
  /\breplication crisis\b/i,
  /\b(direct )?replications? in science\b/i,
  /\bquestionable research practices\b/i,
  /\bpost-?publication (peer )?review\b/i,
  /\bexpressions? of concern\b/i,
  /\bpaper mills?\b/i,
  /\bwhistleblow(er|ing)\b/i,
  /\bself-?correction (of|in) science\b/i,
  /\bcitations? (to|of) retracted\b/i,
  /\bfraud, arrogance\b/i,
];

/** Venues whose entire remit is meta-research and publication ethics. */
const META_RESEARCH_VENUES: RegExp[] = [
  /research integrity and peer review/i,
  /accountability in research/i,
  /science and engineering ethics/i,
  /journal of empirical research on human research ethics/i,
  /\bscientometrics\b/i,
  /research (policy|evaluation)/i,
  /learned publishing/i,
  /\bquantitative science studies\b/i,
];

/**
 * Work types that are commentary rather than primary research.
 *
 * These do not by themselves imply disputing intent — an editorial can endorse
 * a finding — so they only count alongside a textual signal.
 */
const COMMENTARY_TYPES = new Set([
  'editorial',
  'letter',
  'erratum',
  'peer-review',
  'other',
]);

export interface IntentSignals {
  title?: string | null;
  venue?: string | null;
  type?: string | null;
  concepts?: string[];
}

export interface IntentClassification {
  intent: CitationIntent | null;
  /** Which rule fired, so the UI can explain the adjustment. */
  reason: string | null;
  /** Confidence is low by construction; surfaced so nobody over-reads it. */
  confidence: 'low' | 'medium';
}

/**
 * Classify the likely intent of a citation from the citing work's metadata.
 *
 * Returns `null` intent when nothing matches, which the model treats as
 * neutral — the default assumption is that a citation is substantive.
 */
export function classifyIntent(signals: IntentSignals): IntentClassification {
  const title = signals.title ?? '';
  const venue = signals.venue ?? '';
  const type = (signals.type ?? '').toLowerCase();

  for (const pattern of META_RESEARCH_PATTERNS) {
    if (pattern.test(title)) {
      return {
        intent: 'disputing',
        reason: `Title indicates meta-research about research integrity (matched ${pattern.source})`,
        // A title explicitly about retraction is about as strong as metadata gets.
        confidence: 'medium',
      };
    }
  }

  for (const pattern of META_RESEARCH_VENUES) {
    if (pattern.test(venue)) {
      return {
        intent: 'disputing',
        reason: `Published in a meta-research venue (${venue})`,
        confidence: 'low',
      };
    }
  }

  const conceptText = (signals.concepts ?? []).join(' ');
  if (/scientific misconduct|research integrity|publication ethics/i.test(conceptText)) {
    return {
      intent: 'disputing',
      reason: 'Subject classification is research integrity',
      confidence: 'low',
    };
  }

  if (COMMENTARY_TYPES.has(type) && /\bconcern\b|\bintegrity\b|\bfraud\b/i.test(title)) {
    return {
      intent: 'disputing',
      reason: `Commentary (${type}) about research integrity`,
      confidence: 'low',
    };
  }

  return { intent: null, reason: null, confidence: 'low' };
}

/**
 * Does this paper look like it is *about* a retraction rather than built on one?
 *
 * Convenience wrapper for the UI, which wants to badge such papers rather than
 * silently show them a reduced number.
 */
export function isLikelyMetaResearch(signals: IntentSignals): boolean {
  return classifyIntent(signals).intent === 'disputing';
}
