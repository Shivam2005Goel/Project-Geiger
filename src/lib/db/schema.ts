/**
 * Neo4j schema: constraints and indexes.
 *
 * Applied idempotently by the ingest pipeline and safe to re-run. Every index
 * here backs a query the app actually issues — search by title, lookup by DOI,
 * filtering by status and year, ordering by contamination score.
 */

import type { Session } from 'neo4j-driver';
import { withWrite } from './driver';

const STATEMENTS = [
  // Identity. openalexId is the primary key everywhere in the system.
  'CREATE CONSTRAINT paper_openalex_id IF NOT EXISTS FOR (p:Paper) REQUIRE p.openalexId IS UNIQUE',

  // DOI lookups drive the paper route and the bibliography checker.
  'CREATE INDEX paper_doi IF NOT EXISTS FOR (p:Paper) ON (p.doi)',

  // Status filtering, and finding flagged papers to propagate dose from.
  'CREATE INDEX paper_status IF NOT EXISTS FOR (p:Paper) ON (p.status)',

  // Year-range filters and the time-axis layout.
  'CREATE INDEX paper_year IF NOT EXISTS FOR (p:Paper) ON (p.publicationYear)',

  // "Most contaminated" listings and graph truncation ordering.
  'CREATE INDEX paper_contamination IF NOT EXISTS FOR (p:Paper) ON (p.contaminationScore)',

  // Detecting stale scores after a model version bump.
  'CREATE INDEX paper_score_version IF NOT EXISTS FOR (p:Paper) ON (p.scoreVersion)',

  // Free-text search over titles for the search box.
  "CREATE FULLTEXT INDEX paper_fulltext IF NOT EXISTS FOR (p:Paper) ON EACH [p.title, p.venue, p.authorNames]",
];

export async function applySchema(session?: Session): Promise<string[]> {
  const applied: string[] = [];

  const run = async (s: Session) => {
    for (const statement of STATEMENTS) {
      await s.executeWrite((tx) => tx.run(statement));
      applied.push(statement.split(' ')[2]);
    }
  };

  if (session) await run(session);
  else await withWrite(run);

  return applied;
}
