/**
 * Graph queries for the paper view.
 *
 * The important correction over the original implementation is direction.
 * `CITES` points from the citing paper to the cited one, so the contamination
 * blast radius of a paper is everything pointing *at* it:
 *
 *   (affected)-[:CITES]->(root)
 *
 * Walking undirected mixes in the root's own bibliography, which is upstream of
 * it and cannot have been contaminated by it.
 *
 * Every traversal here is bounded. Node selection is ordered by contamination
 * score and citation count so that when a neighbourhood exceeds the cap, what
 * survives is the part that matters, and the caller is told it was cut.
 */

import { limits } from '../../config';
import { int, toNumber, withRead } from '../driver';
import { rowToPaperNode } from '../mappers';
import type {
  CitationEdge,
  ContaminationPath,
  PaperGraph,
  PaperNode,
  TraversalDirection,
} from '../../types';

export interface GraphOptions {
  direction?: TraversalDirection;
  depth?: number;
  limit?: number;
  /** Restrict to papers published within this inclusive year range. */
  yearFrom?: number;
  yearTo?: number;
  /** Only include papers at or above this contamination score. */
  minScore?: number;
  /** Only include papers with one of these statuses. */
  statuses?: string[];
}

interface ResolvedOptions {
  direction: TraversalDirection;
  depth: number;
  limit: number;
  yearFrom: number | null;
  yearTo: number | null;
  minScore: number | null;
  statuses: string[] | null;
}

/**
 * Clamp caller-supplied options into safe ranges.
 *
 * Depth in particular is interpolated into the Cypher pattern (Neo4j does not
 * accept a parameter for variable-length bounds), so it must be a validated
 * small integer before it goes anywhere near a query string.
 */
export function resolveOptions(options: GraphOptions = {}): ResolvedOptions {
  const depthRaw = Math.trunc(options.depth ?? limits.defaultGraphDepth);
  const limitRaw = Math.trunc(options.limit ?? limits.defaultGraphNodes);

  return {
    direction: options.direction ?? 'downstream',
    depth: Math.min(Math.max(Number.isFinite(depthRaw) ? depthRaw : 1, 1), limits.maxGraphDepth),
    limit: Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 1, 1), limits.maxGraphNodes),
    yearFrom: Number.isFinite(options.yearFrom) ? Number(options.yearFrom) : null,
    yearTo: Number.isFinite(options.yearTo) ? Number(options.yearTo) : null,
    minScore: Number.isFinite(options.minScore) ? Number(options.minScore) : null,
    statuses: options.statuses?.length ? options.statuses : null,
  };
}

/** The relationship pattern for each traversal direction. */
function pattern(direction: TraversalDirection, depth: number): string {
  const hops = `*1..${depth}`;
  switch (direction) {
    // Papers that cite the root, transitively — the contamination direction.
    case 'downstream':
      return `(n:Paper)-[:CITES${hops}]->(root)`;
    // The root's own bibliography.
    case 'upstream':
      return `(root)-[:CITES${hops}]->(n:Paper)`;
    case 'both':
      return `(n:Paper)-[:CITES${hops}]-(root)`;
  }
}

function neighbourFilters(options: ResolvedOptions): string {
  const clauses: string[] = [];
  if (options.yearFrom !== null) clauses.push('n.publicationYear >= $yearFrom');
  if (options.yearTo !== null) clauses.push('n.publicationYear <= $yearTo');
  if (options.minScore !== null) clauses.push('coalesce(n.contaminationScore, 0) >= $minScore');
  if (options.statuses) clauses.push('n.status IN $statuses');
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

/** Look one paper up by DOI without pulling its neighbourhood. */
export async function getPaperByDoi(doi: string): Promise<PaperNode | null> {
  return withRead(async (session) => {
    const result = await session.executeRead((tx) =>
      tx.run('MATCH (p:Paper {doi: $doi}) RETURN properties(p) AS props LIMIT 1', {
        doi: doi.toLowerCase(),
      }),
    );
    if (!result.records.length) return null;
    return rowToPaperNode(result.records[0].get('props'));
  });
}

export async function getPaperById(id: string): Promise<PaperNode | null> {
  return withRead(async (session) => {
    const result = await session.executeRead((tx) =>
      tx.run('MATCH (p:Paper {openalexId: $id}) RETURN properties(p) AS props LIMIT 1', { id }),
    );
    if (!result.records.length) return null;
    return rowToPaperNode(result.records[0].get('props'));
  });
}

/**
 * Fetch a paper together with its citation neighbourhood.
 *
 * Runs as three bounded queries rather than one: select the root, select a
 * capped and ordered set of neighbours, then fetch only the edges that fall
 * within that set. Collecting nodes and relationships from matched paths in a
 * single query — the original approach — has no way to bound its result and
 * degrades badly the moment a paper has more than a few hundred citations.
 */
export async function getPaperGraph(
  doi: string,
  options: GraphOptions = {},
): Promise<PaperGraph | null> {
  const opts = resolveOptions(options);
  const normalisedDoi = doi.toLowerCase();

  return withRead(async (session) => {
    const rootResult = await session.executeRead((tx) =>
      tx.run('MATCH (p:Paper {doi: $doi}) RETURN properties(p) AS props LIMIT 1', {
        doi: normalisedDoi,
      }),
    );
    if (!rootResult.records.length) return null;
    const root = rowToPaperNode(rootResult.records[0].get('props'));

    const params = {
      doi: normalisedDoi,
      limit: int(opts.limit),
      yearFrom: opts.yearFrom,
      yearTo: opts.yearTo,
      minScore: opts.minScore,
      statuses: opts.statuses,
    };

    // Ordering decides what survives truncation: the most contaminated and
    // most-cited neighbours are the ones worth showing.
    const neighbourResult = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (root:Paper {doi: $doi})
        MATCH ${pattern(opts.direction, opts.depth)}
        ${neighbourFilters(opts)}
        WITH DISTINCT n
        ORDER BY coalesce(n.contaminationScore, 0) DESC,
                 coalesce(n.citedByCount, 0) DESC,
                 n.openalexId
        WITH collect(n.openalexId) AS allIds
        RETURN allIds[0..$limit] AS ids, size(allIds) AS total
        `,
        params,
      ),
    );

    const ids: string[] = neighbourResult.records[0]?.get('ids') ?? [];
    const totalAvailable = toNumber(neighbourResult.records[0]?.get('total')) ?? 0;
    const allIds = [root.id, ...ids.filter((id) => id !== root.id)];

    const nodeResult = await session.executeRead((tx) =>
      tx.run(
        'MATCH (p:Paper) WHERE p.openalexId IN $ids RETURN properties(p) AS props',
        { ids: allIds },
      ),
    );
    const nodes = nodeResult.records.map((r) => rowToPaperNode(r.get('props')));

    // Induced subgraph: every citation with both endpoints in the selection.
    const edgeResult = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (a:Paper)-[:CITES]->(b:Paper)
        WHERE a.openalexId IN $ids AND b.openalexId IN $ids
        RETURN a.openalexId AS source,
               b.openalexId AS target,
               a.publicationDate AS citingDate,
               a.publicationYear AS citingYear,
               b.retractionDate AS retractionDate,
               b.retractionYear AS retractionYear,
               b.status AS citedStatus
        `,
        { ids: allIds },
      ),
    );

    const edges: CitationEdge[] = edgeResult.records.map((r) => ({
      source: r.get('source'),
      target: r.get('target'),
      postRetraction: isPostRetraction(
        r.get('citingDate'),
        toNumber(r.get('citingYear')),
        r.get('retractionDate'),
        toNumber(r.get('retractionYear')),
        r.get('citedStatus'),
      ),
    }));

    return {
      root,
      nodes,
      edges,
      meta: {
        direction: opts.direction,
        depth: opts.depth,
        requestedLimit: opts.limit,
        truncated: totalAvailable > ids.length,
        totalAvailable,
        retractedCount: nodes.filter((n) => n.status === 'retracted').length,
        contaminatedCount: nodes.filter(
          (n) => (n.contamination?.score ?? 0) > 0 && n.status !== 'retracted',
        ).length,
        generatedAt: new Date().toISOString(),
      },
    };
  });
}

/**
 * Was this citation made after the cited paper's retraction notice?
 *
 * Mirrors `compareToNotice` in the scoring module but works on the flat
 * properties the edge query returns, so styling a "cited anyway" edge does not
 * require loading both full nodes.
 */
function isPostRetraction(
  citingDate: string | null,
  citingYear: number | null,
  retractionDate: string | null,
  retractionYear: number | null,
  citedStatus: string | null,
): boolean {
  if (citedStatus === 'clean' || citedStatus === null) return false;
  if (citingDate && retractionDate) return citingDate.slice(0, 10) > retractionDate.slice(0, 10);
  if (citingYear != null && retractionYear != null) return citingYear > retractionYear;
  return false;
}

/**
 * The citation chains that give a paper its score.
 *
 * Walks the paper's own references looking for flagged work, stopping at the
 * first flagged ancestor on each branch — going further would report a chain
 * through a retracted paper's own bibliography, which is not how dose flows.
 */
export async function getContaminationPaths(
  id: string,
  maxPaths = limits.maxExplanationPaths,
): Promise<ContaminationPath[]> {
  const depth = limits.maxGraphDepth;

  return withRead(async (session) => {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH path = (target:Paper {openalexId: $id})-[:CITES*1..${depth}]->(flagged:Paper)
        WHERE flagged.status <> 'clean'
          // A cycle back to the paper itself explains nothing. Real citation
          // data contains them (preprint and version artefacts), so exclude
          // the target explicitly rather than assuming a DAG.
          AND flagged.openalexId <> $id
          AND ALL(m IN nodes(path)[1..-1] WHERE m.status = 'clean' AND m.openalexId <> $id)
        WITH path, flagged, length(path) AS hops
        ORDER BY hops ASC, coalesce(flagged.citedByCount, 0) DESC
        LIMIT $maxPaths
        RETURN [n IN nodes(path) | properties(n)] AS nodeProps, hops
        `,
        { id, maxPaths: int(maxPaths) },
      ),
    );

    return result.records.map((record) => {
      // Stored target-first; reported source-first so a reader follows the
      // chain the way contamination actually travelled.
      const nodes = (record.get('nodeProps') as Record<string, unknown>[])
        .map(rowToPaperNode)
        .reverse();
      const hops = toNumber(record.get('hops')) ?? nodes.length - 1;
      const flagged = nodes[0];
      const affected = nodes[nodes.length - 1];

      return {
        nodeIds: nodes.map((n) => n.id),
        nodes,
        hops,
        contribution: 0,
        postRetraction: isPostRetraction(
          affected.publicationDate,
          affected.publicationYear,
          flagged.retraction?.noticeDate ?? null,
          flagged.retraction?.noticeYear ?? null,
          flagged.status,
        ),
      } satisfies ContaminationPath;
    });
  });
}

/** Papers carrying the highest contamination, for the dataset overview. */
export async function getMostContaminated(limit = 20): Promise<PaperNode[]> {
  return withRead(async (session) => {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (p:Paper)
        WHERE coalesce(p.contaminationScore, 0) > 0 AND p.status = 'clean'
        RETURN properties(p) AS props
        ORDER BY p.contaminationScore DESC, coalesce(p.citedByCount, 0) DESC
        LIMIT $limit
        `,
        { limit: int(limit) },
      ),
    );
    return result.records.map((r) => rowToPaperNode(r.get('props')));
  });
}
