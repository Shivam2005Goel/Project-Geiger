/**
 * Writing papers and citations into Neo4j.
 *
 * Notably absent: any contamination score. Scores are a derived quantity
 * computed by `scoreCorpus` once the graph is complete, because a score
 * assigned at insert time can only ever reflect the fragment of the graph
 * that happened to be loaded first. The original loader's
 * `CASE WHEN retracted THEN 100 ELSE 10 END` was that mistake in its purest
 * form — a constant standing in for a measurement.
 */

import { scoreGraph, type ScoringEdge, type ScoringPaper } from '../scoring/contamination';
import { classifyIntent } from '../scoring/intent';
import { SCORE_VERSION } from '../config';
import { toNumber, withRead, withWrite } from '../db/driver';
import { paperNodeToProps } from '../db/mappers';
import type { PaperNode } from '../types';
import type { CrawlEdge } from './crawl';

/** Batch size for writes. Large enough to be fast, small enough to not time out. */
const BATCH = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface PersistResult {
  nodesWritten: number;
  edgesWritten: number;
}

/**
 * Upsert papers.
 *
 * Bibliographic fields are overwritten wholesale — a fresh crawl has better
 * titles and counts than an old one. Integrity fields are merged upward
 * instead: a crawl only ever sees OpenAlex's coarse `is_retracted` boolean, so
 * letting it write status directly would silently undo an enrichment pass that
 * had established a paper was retracted, or discard a notice date. Re-running
 * ingest must never lose integrity information.
 */
export async function persistPapers(papers: PaperNode[]): Promise<number> {
  if (!papers.length) return 0;
  let written = 0;

  await withWrite(async (session) => {
    for (const batch of chunk(papers.map(paperNodeToProps), BATCH)) {
      await session.executeWrite((tx) =>
        tx.run(
          `
          UNWIND $rows AS row
          MERGE (p:Paper {openalexId: row.openalexId})
          SET p += row.core
          WITH p, row,
               [s IN [coalesce(p.status, 'clean'), row.status] |
                  CASE s WHEN 'retracted' THEN 3
                         WHEN 'concerned' THEN 2
                         WHEN 'corrected' THEN 1
                         ELSE 0 END] AS ranks
          SET p.status = CASE
                WHEN ranks[0] >= ranks[1] THEN coalesce(p.status, 'clean')
                ELSE row.status END
          SET p.retracted = p.status = 'retracted',
              // coalesce so a crawl that knows no date cannot erase one that
              // enrichment already found
              p.retractionDate = coalesce(row.retractionDate, p.retractionDate),
              p.retractionYear = coalesce(row.retractionYear, p.retractionYear),
              p.retractionNature = coalesce(row.retractionNature, p.retractionNature),
              p.retractionNoticeUrl = coalesce(row.retractionNoticeUrl, p.retractionNoticeUrl),
              p.retractionSource = coalesce(row.retractionSource, p.retractionSource),
              p.retractionReasons = CASE
                WHEN size(row.retractionReasons) > 0 THEN row.retractionReasons
                ELSE coalesce(p.retractionReasons, []) END
                
          FOREACH (author IN coalesce(row.authors, []) |
             MERGE (a:Author {id: coalesce(author.id, author.name)})
             SET a.name = author.name,
                 a.orcid = author.orcid
             MERGE (a)-[:AUTHORED]->(p)
          )
          `,
          { rows: batch },
        ),
      );
      written += batch.length;
    }
  });

  return written;
}

/**
 * Upsert citations.
 *
 * Both endpoints must already exist — an edge to a paper we never fetched
 * carries no information and would create a property-less phantom node.
 */
export async function persistEdges(edges: CrawlEdge[]): Promise<number> {
  if (!edges.length) return 0;
  let written = 0;

  await withWrite(async (session) => {
    for (const batch of chunk(edges, BATCH)) {
      const result = await session.executeWrite((tx) =>
        tx.run(
          `
          UNWIND $rows AS row
          MATCH (source:Paper {openalexId: row.source})
          MATCH (target:Paper {openalexId: row.target})
          MERGE (source)-[:CITES]->(target)
          RETURN count(*) AS written
          `,
          { rows: batch },
        ),
      );
      written += toNumber(result.records[0]?.get('written')) ?? 0;
    }
  });

  return written;
}

export async function persist(
  papers: PaperNode[],
  edges: CrawlEdge[],
): Promise<PersistResult> {
  const nodesWritten = await persistPapers(papers);
  const edgesWritten = await persistEdges(edges);
  return { nodesWritten, edgesWritten };
}

/** Load the whole corpus in the minimal shape the scoring model needs. */
export async function loadScoringCorpus(): Promise<{
  papers: ScoringPaper[];
  edges: ScoringEdge[];
  intentByPaper: Map<string, ReturnType<typeof classifyIntent>>;
}> {
  return withRead(async (session) => {
    const nodeResult = await session.executeRead((tx) =>
      tx.run(`
        MATCH (p:Paper)
        RETURN p.openalexId AS id,
               coalesce(p.status, CASE WHEN p.retracted THEN 'retracted' ELSE 'clean' END) AS status,
               p.publicationDate AS publicationDate,
               p.publicationYear AS publicationYear,
               p.referencedCount AS referencedCount,
               p.retractionDate AS retractionDate,
               p.retractionYear AS retractionYear,
               p.title AS title,
               p.venue AS venue,
               p.type AS type,
               p.concepts AS concepts
      `),
    );

    const papers: ScoringPaper[] = nodeResult.records.map((r) => ({
      id: r.get('id'),
      status: r.get('status'),
      publicationDate: r.get('publicationDate'),
      publicationYear: toNumber(r.get('publicationYear')),
      referencedCount: toNumber(r.get('referencedCount')),
      retractionDate: r.get('retractionDate'),
      retractionYear: toNumber(r.get('retractionYear')),
    }));

    // Intent is a property of the citing paper's stance, so it is derived once
    // per paper and then stamped onto every edge leaving it.
    const intentByPaper = new Map<string, ReturnType<typeof classifyIntent>>();
    for (const r of nodeResult.records) {
      intentByPaper.set(
        r.get('id'),
        classifyIntent({
          title: r.get('title'),
          venue: r.get('venue'),
          type: r.get('type'),
          concepts: r.get('concepts') ?? [],
        }),
      );
    }

    const edgeResult = await session.executeRead((tx) =>
      tx.run(`
        MATCH (a:Paper)-[:CITES]->(b:Paper)
        RETURN a.openalexId AS source, b.openalexId AS target
      `),
    );

    const edges: ScoringEdge[] = edgeResult.records.map((r) => {
      const source = r.get('source');
      return {
        source,
        target: r.get('target'),
        intent: intentByPaper.get(source)?.intent ?? null,
      };
    });

    return { papers, edges, intentByPaper };
  });
}

export interface ScoreRunSummary {
  papersScored: number;
  contaminated: number;
  flagged: number;
  /** Papers whose citations were down-weighted as integrity commentary. */
  commentary: number;
  version: string;
  durationMs: number;
}

/**
 * Recompute contamination for the entire corpus and write the results back.
 *
 * Runs as a batch job rather than per request: propagation touches every
 * flagged paper's full descendant set, which is far too expensive to do while
 * someone waits for a page, and produces scores that are only comparable if
 * they were all computed against the same graph.
 */
export async function scoreCorpus(
  options: { onProgress?: (message: string) => void } = {},
): Promise<ScoreRunSummary> {
  const log = options.onProgress ?? (() => {});
  const started = Date.now();

  log('loading corpus...');
  const { papers, edges, intentByPaper } = await loadScoringCorpus();
  log(`loaded ${papers.length} papers, ${edges.length} citations`);

  const flagged = papers.filter((p) => p.status !== 'clean').length;
  const commentary = [...intentByPaper.values()].filter((c) => c.intent === 'disputing').length;
  log(`propagating from ${flagged} flagged papers...`);
  log(`${commentary} papers classified as commentary about integrity (down-weighted)`);

  const scores = scoreGraph(papers, edges);
  const scoredAt = new Date().toISOString();

  const rows = [...scores.entries()].map(([id, assessment]) => ({
    id,
    contaminationScore: assessment.score,
    contaminationDose: assessment.dose,
    directHits: assessment.directHits,
    totalUpstreamRetractions: assessment.totalUpstreamRetractions,
    minHops: assessment.minHops,
    postRetractionCitations: assessment.postRetractionCitations,
    scoreVersion: assessment.version,
    scoredAt,
    citationIntent: intentByPaper.get(id)?.intent ?? null,
    intentReason: intentByPaper.get(id)?.reason ?? null,
    intentConfidence: intentByPaper.get(id)?.confidence ?? null,
  }));

  log(`writing ${rows.length} scores...`);
  await withWrite(async (session) => {
    for (const batch of chunk(rows, BATCH)) {
      await session.executeWrite((tx) =>
        tx.run(
          `
          UNWIND $rows AS row
          MATCH (p:Paper {openalexId: row.id})
          SET p.contaminationScore = row.contaminationScore,
              p.contaminationDose = row.contaminationDose,
              p.directHits = row.directHits,
              p.totalUpstreamRetractions = row.totalUpstreamRetractions,
              p.minHops = row.minHops,
              p.postRetractionCitations = row.postRetractionCitations,
              p.scoreVersion = row.scoreVersion,
              p.scoredAt = row.scoredAt,
              p.citationIntent = row.citationIntent,
              p.intentReason = row.intentReason,
              p.intentConfidence = row.intentConfidence
          `,
          { rows: batch },
        ),
      );
    }
  });

  const contaminated = rows.filter(
    (r) => r.contaminationScore > 0 && r.minHops !== 0,
  ).length;

  return {
    papersScored: rows.length,
    contaminated,
    flagged,
    commentary,
    version: SCORE_VERSION,
    durationMs: Date.now() - started,
  };
}

/**
 * Score a freshly crawled fragment without touching the rest of the corpus.
 *
 * Used on the on-demand path, where re-scoring everything would make a page
 * load take minutes. The result is a local estimate over the fragment; the
 * batch job remains the authority, and `scoreVersion` records which produced
 * a given number.
 */
export async function scoreFragment(
  papers: PaperNode[],
  edges: CrawlEdge[],
): Promise<number> {
  const scoringPapers: ScoringPaper[] = papers.map((p) => ({
    id: p.id,
    status: p.status,
    publicationDate: p.publicationDate,
    publicationYear: p.publicationYear,
    referencedCount: p.referencedCount,
    retractionDate: p.retraction?.noticeDate ?? null,
    retractionYear: p.retraction?.noticeYear ?? null,
  }));

  const intents = new Map(
    papers.map((p) => [
      p.id,
      classifyIntent({ title: p.title, venue: p.venue, type: p.type, concepts: p.concepts }),
    ]),
  );
  const intentEdges: CrawlEdge[] & ScoringEdge[] = edges.map((e) => ({
    ...e,
    intent: intents.get(e.source)?.intent ?? null,
  })) as never;

  const scores = scoreGraph(scoringPapers, intentEdges);
  const scoredAt = new Date().toISOString();

  const rows = [...scores.entries()].map(([id, a]) => ({
    id,
    contaminationScore: a.score,
    contaminationDose: a.dose,
    directHits: a.directHits,
    totalUpstreamRetractions: a.totalUpstreamRetractions,
    minHops: a.minHops,
    postRetractionCitations: a.postRetractionCitations,
    scoreVersion: `${a.version}+fragment`,
    scoredAt,
    citationIntent: intents.get(id)?.intent ?? null,
    intentReason: intents.get(id)?.reason ?? null,
    intentConfidence: intents.get(id)?.confidence ?? null,
  }));

  await withWrite(async (session) => {
    for (const batch of chunk(rows, BATCH)) {
      await session.executeWrite((tx) =>
        tx.run(
          `
          UNWIND $rows AS row
          MATCH (p:Paper {openalexId: row.id})
          SET p.contaminationScore = row.contaminationScore,
              p.contaminationDose = row.contaminationDose,
              p.directHits = row.directHits,
              p.totalUpstreamRetractions = row.totalUpstreamRetractions,
              p.minHops = row.minHops,
              p.postRetractionCitations = row.postRetractionCitations,
              p.scoreVersion = row.scoreVersion,
              p.scoredAt = row.scoredAt,
              p.citationIntent = row.citationIntent,
              p.intentReason = row.intentReason,
              p.intentConfidence = row.intentConfidence
          `,
          { rows: batch },
        ),
      );
    }
  });

  return rows.length;
}
