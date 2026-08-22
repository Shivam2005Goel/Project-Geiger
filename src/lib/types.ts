/** Shared domain types for Project Geiger. */

/**
 * Integrity status of a paper.
 *
 * Deliberately not a boolean: formal retraction is the last step of a long
 * process, and the states before it carry most of the early-warning value.
 * Ordered by severity.
 */
export type IntegrityStatus =
  | 'clean'
  | 'corrected'
  | 'concerned'
  | 'retracted';

export const INTEGRITY_STATUS_ORDER: IntegrityStatus[] = [
  'clean',
  'corrected',
  'concerned',
  'retracted',
];

/** How a paper came to be flagged, kept separate from the flag itself. */
export interface RetractionRecord {
  /** ISO date of the notice, when known. */
  noticeDate?: string;
  noticeYear?: number;
  /**
   * Reason taxonomy from Retraction Watch / Crossref. Free-form strings
   * rather than an enum because the upstream vocabulary evolves.
   */
  reasons: string[];
  /** `retraction`, `expression_of_concern`, `correction`, ... */
  nature?: string;
  /** DOI or URL of the notice itself, so users can read the primary source. */
  noticeUrl?: string;
  /** Which dataset asserted this. */
  source?: string;
}

export interface Author {
  id?: string;
  name: string;
  orcid?: string;
}

/** A paper node as stored and as returned by the API. */
export interface PaperNode {
  /** OpenAlex work ID — the primary key throughout the system. */
  id: string;
  doi: string | null;
  title: string | null;
  publicationYear: number | null;
  publicationDate: string | null;
  type: string | null;
  venue: string | null;
  authors: Author[];
  concepts: string[];
  /** Global citation count from OpenAlex, not just within our subgraph. */
  citedByCount: number;
  /** Size of this paper's own reference list — the reliance denominator. */
  referencedCount: number;

  status: IntegrityStatus;
  retracted: boolean;
  retraction: RetractionRecord | null;

  /** Contamination assessment; null if this node has not been scored yet. */
  contamination: ContaminationAssessment | null;

  /** Provenance. */
  fetchedAt: string | null;
  sources: string[];
}

/**
 * The result of the contamination model for one paper. Never surfaced as a
 * bare number — the supporting counts travel with it so the UI can always
 * show its basis.
 */
export interface ContaminationAssessment {
  /** 0-100, saturating. 100 is reserved for retracted papers themselves. */
  score: number;
  /** Raw accumulated dose before normalisation, for debugging and analysis. */
  dose: number;
  /** Retracted works cited directly by this paper. */
  directHits: number;
  /** Distinct retracted works anywhere upstream within the horizon. */
  totalUpstreamRetractions: number;
  /** Shortest hop distance to any retracted work; 0 if itself retracted. */
  minHops: number | null;
  /**
   * Retracted works this paper cited *after* the retraction notice was
   * published. The strongest single integrity signal in the model.
   */
  postRetractionCitations: number;
  /** Parameter set used, so scores from different runs are comparable. */
  version: string;
  computedAt: string | null;
  /**
   * Heuristic classification of how this paper cites flagged work. When set to
   * `disputing`, the paper appears to be writing *about* the retraction rather
   * than relying on it, and its score has been reduced accordingly.
   */
  citationIntent: 'supporting' | 'mentioning' | 'disputing' | null;
  /** Why the classifier decided that, shown to the reader alongside the score. */
  intentReason: string | null;
}

export interface CitationEdge {
  /** OpenAlex ID of the citing paper. */
  source: string;
  /** OpenAlex ID of the cited paper. */
  target: string;
  /**
   * True when the citing paper was published after the cited paper's
   * retraction notice. Drives the "cited anyway" edge styling.
   */
  postRetraction?: boolean;
}

export interface PaperGraph {
  root: PaperNode;
  nodes: PaperNode[];
  edges: CitationEdge[];
  meta: GraphMeta;
}

export interface GraphMeta {
  /** Direction actually traversed. */
  direction: TraversalDirection;
  depth: number;
  requestedLimit: number;
  /** True when the neighbourhood was larger than the limit and was cut. */
  truncated: boolean;
  /** Total neighbourhood size before truncation, when known. */
  totalAvailable: number | null;
  retractedCount: number;
  contaminatedCount: number;
  generatedAt: string;
}

/**
 * Which way to walk the citation graph.
 *
 * `downstream` is the contamination direction: papers that cite the root, and
 * papers that cite those. `upstream` walks the root's own bibliography.
 */
export type TraversalDirection = 'downstream' | 'upstream' | 'both';

/** One step of an explanation: why does this paper carry a score? */
export interface ContaminationPath {
  /** Ordered node IDs from the retracted source to the affected paper. */
  nodeIds: string[];
  /** Resolved nodes, same order, for rendering without a second fetch. */
  nodes: PaperNode[];
  hops: number;
  /** Dose this specific path contributed. */
  contribution: number;
  /** Whether each hop was a post-retraction citation. */
  postRetraction: boolean;
}

export interface SearchResult {
  id: string;
  doi: string | null;
  title: string | null;
  publicationYear: number | null;
  venue: string | null;
  authors: string[];
  citedByCount: number;
  status: IntegrityStatus;
  /** True when the paper is already loaded in our graph database. */
  inDatabase: boolean;
  contaminationScore: number | null;
}

/** One entry in a bibliography check. */
export interface BibliographyFinding {
  /** What the user gave us, echoed back so they can match rows up. */
  input: string;
  doi: string | null;
  resolved: boolean;
  paper: PaperNode | null;
  status: IntegrityStatus;
  contaminationScore: number | null;
  /**
   * Set when the reference itself is fine but it inherits contamination from
   * its own references.
   */
  inheritedFrom: { id: string; title: string | null; doi: string | null }[];
  note: string | null;
}

export interface BibliographyReport {
  findings: BibliographyFinding[];
  summary: {
    total: number;
    resolved: number;
    unresolved: number;
    retracted: number;
    concerned: number;
    corrected: number;
    contaminated: number;
    clean: number;
  };
  generatedAt: string;
  scoreVersion: string;
}

export interface DatasetStats {
  papers: number;
  citations: number;
  retracted: number;
  concerned: number;
  corrected: number;
  contaminated: number;
  scored: number;
  scoreVersion: string;
  earliestYear: number | null;
  latestYear: number | null;
  lastIngestAt: string | null;
}
