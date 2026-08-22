import { getContaminationPaths, getPaperByDoi } from '@/lib/db/queries/paper';
import { apiError, cached, guarded, parseDoi, parseInt as parseIntParam } from '@/lib/api/guard';
import { cache, limits } from '@/lib/config';

export const runtime = 'nodejs';

/**
 * Why does this paper carry a contamination score?
 *
 * Returns the actual citation chains back to flagged work. This endpoint is
 * the reason the score is defensible: a number nobody can interrogate is a
 * number nobody should trust.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ doi: string[] }> },
) {
  return guarded(request, async () => {
    const { doi: segments } = await params;
    const doi = parseDoi(segments);
    const url = new URL(request.url);
    const maxPaths = parseIntParam(url.searchParams.get('limit'), {
      min: 1, max: 100, fallback: limits.maxExplanationPaths, name: 'limit',
    });

    const paper = await getPaperByDoi(doi);
    if (!paper) {
      return apiError(404, 'Paper not found', {
        detail: `${doi} is not in the corpus.`,
        hint: `Load it first by requesting /api/paper/${encodeURIComponent(doi)}`,
      });
    }

    const paths = await getContaminationPaths(paper.id, maxPaths);

    return cached({
      paper,
      paths,
      assessment: paper.contamination,
      explanation: paths.length
        ? `${paths.length} citation chain(s) connect this paper to flagged work.`
        : 'No path from this paper to any flagged work was found in the corpus.',
    }, cache.graphTtl);
  }, { scope: 'paths' });
}
