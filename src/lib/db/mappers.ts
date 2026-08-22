/**
 * Translation between Neo4j node properties and Geiger's domain types.
 *
 * Neo4j stores flat scalars and arrays, so nested structures (authors,
 * retraction records, contamination assessments) are flattened on write and
 * rebuilt on read. Keeping both directions in one file is what stops the two
 * from drifting apart.
 */

import type { Node } from 'neo4j-driver';
import { toNumber } from './driver';
import type {
  Author,
  ContaminationAssessment,
  IntegrityStatus,
  PaperNode,
  RetractionRecord,
} from '../types';

const VALID_STATUSES: IntegrityStatus[] = ['clean', 'corrected', 'concerned', 'retracted'];

function asStatus(value: unknown, retractedFallback: unknown): IntegrityStatus {
  if (typeof value === 'string' && VALID_STATUSES.includes(value as IntegrityStatus)) {
    return value as IntegrityStatus;
  }
  // Nodes written before the status ladder existed only have the boolean.
  return retractedFallback === true ? 'retracted' : 'clean';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

/** Rebuild a `PaperNode` from stored properties. */
export function rowToPaperNode(props: Record<string, unknown>): PaperNode {
  const status = asStatus(props.status, props.retracted);

  let authors: Author[] = [];
  if (typeof props.authorsJson === 'string') {
    try {
      const parsed: unknown = JSON.parse(props.authorsJson);
      if (Array.isArray(parsed)) authors = parsed as Author[];
    } catch {
      // A malformed blob should cost us the author list, not the whole node.
      authors = [];
    }
  }
  if (!authors.length) {
    authors = asStringArray(props.authorNamesList).map((name) => ({ name }));
  }

  const retractionYear = toNumber(props.retractionYear);
  const retraction: RetractionRecord | null =
    status === 'clean'
      ? null
      : {
          noticeDate: (props.retractionDate as string) ?? undefined,
          noticeYear: retractionYear ?? undefined,
          reasons: asStringArray(props.retractionReasons),
          nature: (props.retractionNature as string) ?? undefined,
          noticeUrl: (props.retractionNoticeUrl as string) ?? undefined,
          source: (props.retractionSource as string) ?? undefined,
        };

  const score = toNumber(props.contaminationScore);
  const contamination: ContaminationAssessment | null =
    score === null
      ? null
      : {
          score,
          dose: toNumber(props.contaminationDose) ?? 0,
          directHits: toNumber(props.directHits) ?? 0,
          totalUpstreamRetractions: toNumber(props.totalUpstreamRetractions) ?? 0,
          minHops: toNumber(props.minHops),
          postRetractionCitations: toNumber(props.postRetractionCitations) ?? 0,
          version: (props.scoreVersion as string) ?? 'unknown',
          computedAt: (props.scoredAt as string) ?? null,
          citationIntent: (props.citationIntent as ContaminationAssessment['citationIntent']) ?? null,
          intentReason: (props.intentReason as string) ?? null,
        };

  return {
    id: props.openalexId as string,
    doi: (props.doi as string) ?? null,
    title: (props.title as string) ?? null,
    publicationYear: toNumber(props.publicationYear),
    publicationDate: (props.publicationDate as string) ?? null,
    type: (props.type as string) ?? null,
    venue: (props.venue as string) ?? null,
    authors,
    concepts: asStringArray(props.concepts),
    citedByCount: toNumber(props.citedByCount) ?? 0,
    referencedCount: toNumber(props.referencedCount) ?? 0,
    status,
    retracted: status === 'retracted',
    retraction,
    contamination,
    fetchedAt: (props.fetchedAt as string) ?? null,
    sources: asStringArray(props.sources),
  };
}

export function nodeToPaperNode(node: Node): PaperNode {
  return rowToPaperNode(node.properties as Record<string, unknown>);
}

/**
 * Flatten a `PaperNode` into properties Neo4j can store.
 *
 * Split into `core` and `integrity` because the two are written with different
 * rules: bibliographic fields from a fresh crawl always win, but integrity
 * fields must never be allowed to downgrade what enrichment has established.
 */
export function paperNodeToProps(paper: PaperNode): {
  openalexId: string;
  core: Record<string, unknown>;
  status: string;
  retractionDate: string | null;
  retractionYear: number | null;
  retractionReasons: string[];
  retractionNature: string | null;
  retractionNoticeUrl: string | null;
  retractionSource: string | null;
} {
  return {
    openalexId: paper.id,
    core: {
      doi: paper.doi,
      title: paper.title,
      publicationYear: paper.publicationYear,
      publicationDate: paper.publicationDate,
      type: paper.type,
      venue: paper.venue,
      authorsJson: JSON.stringify(paper.authors),
      // Denormalised for the fulltext index, which cannot see into JSON.
      authorNames: paper.authors.map((a) => a.name).join('; '),
      authorNamesList: paper.authors.map((a) => a.name),
      concepts: paper.concepts,
      citedByCount: paper.citedByCount,
      referencedCount: paper.referencedCount,
      fetchedAt: paper.fetchedAt,
      sources: paper.sources,
    },
    status: paper.status,
    retractionDate: paper.retraction?.noticeDate ?? null,
    retractionYear: paper.retraction?.noticeYear ?? null,
    retractionReasons: paper.retraction?.reasons ?? [],
    retractionNature: paper.retraction?.nature ?? null,
    retractionNoticeUrl: paper.retraction?.noticeUrl ?? null,
    retractionSource: paper.retraction?.source ?? null,
  };
}
