/**
 * Search.
 *
 * Two tiers, in this order: what we already hold in the graph (fast, and
 * carries a contamination score), then OpenAlex for everything else. A
 * researcher looking up their own paper will usually miss the local corpus,
 * so falling through to OpenAlex is what makes the search box useful rather
 * than a demo of our own dataset.
 */

import { limits } from '../../config';
import { int, toNumber, withRead } from '../driver';
import { rowToPaperNode } from '../mappers';
import {
  normaliseDoi,
  resolveIdentifier,
  searchWorks,
  toPaperNode,
} from '../../sources/openalex';
import type { IntegrityStatus, PaperNode, SearchResult } from '../../types';

function toSearchResult(paper: PaperNode, inDatabase: boolean): SearchResult {
  return {
    id: paper.id,
    doi: paper.doi,
    title: paper.title,
    publicationYear: paper.publicationYear,
    venue: paper.venue,
    authors: paper.authors.map((a) => a.name),
    citedByCount: paper.citedByCount,
    status: paper.status,
    inDatabase,
    contaminationScore: paper.contamination?.score ?? null,
  };
}

/** Exact-identifier lookup against the local graph. */
async function localExact(input: string): Promise<PaperNode | null> {
  const doi = normaliseDoi(input);
  const id = /^W\d+$/i.test(input.trim()) ? `https://openalex.org/${input.trim()}` : null;
  if (!doi && !id) return null;

  return withRead(async (session) => {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (p:Paper)
        WHERE ($doi IS NOT NULL AND p.doi = $doi)
           OR ($id IS NOT NULL AND p.openalexId = $id)
        RETURN properties(p) AS props LIMIT 1
        `,
        { doi, id },
      ),
    );
    return result.records.length ? rowToPaperNode(result.records[0].get('props')) : null;
  });
}

/**
 * Full-text search over the local corpus.
 *
 * Falls back to a `CONTAINS` scan when the fulltext index is unavailable —
 * a fresh database that has not run the schema step should degrade to slow
 * search rather than to an error page.
 */
async function localFullText(query: string, limit: number): Promise<PaperNode[]> {
  return withRead(async (session) => {
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          CALL db.index.fulltext.queryNodes('paper_fulltext', $query)
          YIELD node, score
          RETURN properties(node) AS props, score
          ORDER BY score DESC, coalesce(node.citedByCount, 0) DESC
          LIMIT $limit
          `,
          { query: escapeLucene(query), limit: int(limit) },
        ),
      );
      return result.records.map((r) => rowToPaperNode(r.get('props')));
    } catch {
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (p:Paper)
          WHERE toLower(p.title) CONTAINS toLower($query)
          RETURN properties(p) AS props
          ORDER BY coalesce(p.citedByCount, 0) DESC
          LIMIT $limit
          `,
          { query, limit: int(limit) },
        ),
      );
      return result.records.map((r) => rowToPaperNode(r.get('props')));
    }
  });
}

/**
 * Escape Lucene's operators so a user typing a colon or a stray bracket gets
 * results instead of a parse error.
 */
function escapeLucene(query: string): string {
  const escaped = query.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1').trim();
  if (!escaped) return '*';
  // Prefix-match the final token so partial words find something as you type.
  const terms = escaped.split(/\s+/);
  const last = terms.pop()!;
  return [...terms, `${last}*`].join(' ');
}

export interface SearchOptions {
  limit?: number;
  /** Skip the OpenAlex fallback — used by tests and by the bulk checker. */
  localOnly?: boolean;
}

export async function search(
  rawQuery: string,
  options: SearchOptions = {},
): Promise<{ results: SearchResult[]; source: 'local' | 'mixed' }> {
  const query = rawQuery.trim();
  const limit = Math.min(options.limit ?? limits.searchLimit, 50);
  if (!query) return { results: [], source: 'local' };

  // An exact identifier should always win, regardless of what text search says.
  const exact = await localExact(query);
  if (exact) {
    return { results: [toSearchResult(exact, true)], source: 'local' };
  }

  const local = await localFullText(query, limit);
  const seen = new Set(local.map((p) => p.id));
  const results = local.map((p) => toSearchResult(p, true));

  if (options.localOnly || results.length >= limit) {
    return { results: results.slice(0, limit), source: 'local' };
  }

  // Not in our corpus. Ask OpenAlex, and mark those results as not-yet-indexed
  // so the UI can offer to ingest them rather than pretending to have data.
  try {
    const identified = await resolveIdentifier(query);
    const works = identified ? [identified] : await searchWorks(query, limit - results.length);
    for (const work of works) {
      if (seen.has(work.id)) continue;
      seen.add(work.id);
      results.push(toSearchResult(toPaperNode(work), false));
    }
    return { results: results.slice(0, limit), source: 'mixed' };
  } catch {
    // Upstream being down should degrade search, not break it.
    return { results: results.slice(0, limit), source: 'local' };
  }
}

/** Resolve many DOIs against the local corpus in one round trip. */
export async function lookupDois(dois: string[]): Promise<Map<string, PaperNode>> {
  const normalised = [...new Set(dois.map((d) => d.toLowerCase()))];
  if (!normalised.length) return new Map();

  return withRead(async (session) => {
    const result = await session.executeRead((tx) =>
      tx.run(
        'MATCH (p:Paper) WHERE p.doi IN $dois RETURN properties(p) AS props',
        { dois: normalised },
      ),
    );
    const map = new Map<string, PaperNode>();
    for (const record of result.records) {
      const paper = rowToPaperNode(record.get('props'));
      if (paper.doi) map.set(paper.doi, paper);
    }
    return map;
  });
}

/**
 * For a set of papers, find which of their references are flagged.
 *
 * This is what lets the bibliography checker say "this reference is fine, but
 * it rests on a retracted paper" — the indirect case that a plain retraction
 * lookup misses entirely.
 */
export async function findFlaggedReferences(
  ids: string[],
): Promise<Map<string, { id: string; title: string | null; doi: string | null; status: IntegrityStatus }[]>> {
  if (!ids.length) return new Map();

  return withRead(async (session) => {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (p:Paper)-[:CITES]->(ref:Paper)
        WHERE p.openalexId IN $ids AND ref.status <> 'clean'
        RETURN p.openalexId AS id,
               collect({
                 id: ref.openalexId,
                 title: ref.title,
                 doi: ref.doi,
                 status: ref.status
               })[0..10] AS refs
        `,
        { ids },
      ),
    );

    const map = new Map<string, { id: string; title: string | null; doi: string | null; status: IntegrityStatus }[]>();
    for (const record of result.records) {
      map.set(record.get('id'), record.get('refs'));
    }
    return map;
  });
}

/** Dataset-wide counters for the overview and the methods page. */
export async function getStats() {
  return withRead(async (session) => {
    const result = await session.executeRead((tx) =>
      tx.run(`
        MATCH (p:Paper)
        WITH count(p) AS papers,
             sum(CASE WHEN p.status = 'retracted' THEN 1 ELSE 0 END) AS retracted,
             sum(CASE WHEN p.status = 'concerned' THEN 1 ELSE 0 END) AS concerned,
             sum(CASE WHEN p.status = 'corrected' THEN 1 ELSE 0 END) AS corrected,
             sum(CASE WHEN coalesce(p.contaminationScore, 0) > 0
                       AND p.status = 'clean' THEN 1 ELSE 0 END) AS contaminated,
             sum(CASE WHEN p.scoreVersion IS NOT NULL THEN 1 ELSE 0 END) AS scored,
             min(p.publicationYear) AS earliestYear,
             max(p.publicationYear) AS latestYear,
             max(p.fetchedAt) AS lastIngestAt,
             head(collect(p.scoreVersion)) AS scoreVersion
        MATCH ()-[c:CITES]->()
        RETURN papers, retracted, concerned, corrected, contaminated, scored,
               earliestYear, latestYear, lastIngestAt, scoreVersion,
               count(c) AS citations
      `),
    );

    const record = result.records[0];
    if (!record) return null;

    return {
      papers: toNumber(record.get('papers')) ?? 0,
      citations: toNumber(record.get('citations')) ?? 0,
      retracted: toNumber(record.get('retracted')) ?? 0,
      concerned: toNumber(record.get('concerned')) ?? 0,
      corrected: toNumber(record.get('corrected')) ?? 0,
      contaminated: toNumber(record.get('contaminated')) ?? 0,
      scored: toNumber(record.get('scored')) ?? 0,
      scoreVersion: (record.get('scoreVersion') as string) ?? 'not scored',
      earliestYear: toNumber(record.get('earliestYear')),
      latestYear: toNumber(record.get('latestYear')),
      lastIngestAt: (record.get('lastIngestAt') as string) ?? null,
    };
  });
}
