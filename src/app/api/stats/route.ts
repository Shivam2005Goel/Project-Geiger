import { getStats } from '@/lib/db/queries/search';
import { getMostContaminated } from '@/lib/db/queries/paper';
import { retractionCoverage } from '@/lib/ingest/enrich';
import { cached, guarded } from '@/lib/api/guard';
import { SCORE_VERSION, cache, scoring } from '@/lib/config';

export const runtime = 'nodejs';

/**
 * Corpus overview, including the model parameters currently in force.
 *
 * Publishing the coefficients alongside the numbers is what makes a result
 * reproducible: anyone can check which parameter set produced a given score,
 * and spot when a score predates a model change.
 */
export async function GET(request: Request) {
  return guarded(request, async () => {
    const [stats, coverage, worst] = await Promise.all([
      getStats(),
      retractionCoverage(),
      getMostContaminated(10),
    ]);

    return cached({
      corpus: stats,
      coverage: {
        ...coverage,
        // The share of flagged papers we can date. Everything undated falls
        // into "unknown timing", which materially weakens its contribution.
        datedShare: coverage.flagged > 0
          ? Math.round((coverage.withDates / coverage.flagged) * 100)
          : null,
      },
      model: { version: SCORE_VERSION, parameters: scoring },
      mostContaminated: worst.map((p) => ({
        id: p.id,
        doi: p.doi,
        title: p.title,
        publicationYear: p.publicationYear,
        score: p.contamination?.score ?? 0,
        minHops: p.contamination?.minHops ?? null,
        directHits: p.contamination?.directHits ?? 0,
        postRetractionCitations: p.contamination?.postRetractionCitations ?? 0,
      })),
    }, cache.statsTtl);
  }, { scope: 'stats' });
}
