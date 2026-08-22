import { NextResponse } from 'next/server';
import { getPaperGraph } from '@/lib/db/queries/paper';
import { crawl, completeInternalEdges } from '@/lib/ingest/crawl';
import { persist, scoreFragment } from '@/lib/ingest/persist';
import { apiError, guarded, parseDoi, parseGraphParams } from '@/lib/api/guard';
import { cache } from '@/lib/config';

export const runtime = 'nodejs';

/**
 * A paper and its citation neighbourhood.
 *
 * When the paper is not in the corpus, the request falls through to a live
 * OpenAlex crawl, persists what it finds, scores that fragment and serves it.
 * That is what lets someone paste any DOI and get an answer instead of a 404
 * telling them to go away — but it is bounded, and the response marks it as a
 * fragment, because a live crawl cannot see the whole citation graph.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ doi: string[] }> },
) {
  return guarded(request, async () => {
    const { doi: segments } = await params;
    const doi = parseDoi(segments);
    const url = new URL(request.url);
    const options = parseGraphParams(url);
    const allowCrawl = url.searchParams.get('crawl') !== 'false';

    let graph = await getPaperGraph(doi, options);

    // A bare node with no neighbourhood means the paper arrived as somebody
    // else's reference and was never crawled in its own right.
    const needsCrawl = !graph || graph.nodes.length <= 1;

    if (needsCrawl && allowCrawl) {
      const result = await crawl(doi, {
        depth: Math.min(options.depth, 2),
        maxWorks: 300,
        perGeneration: 120,
        direction: options.direction === 'upstream' ? 'upstream' : 'both',
      });

      if (!result.seed) {
        return apiError(404, 'Paper not found', {
          detail: `No work with DOI ${doi} exists in OpenAlex.`,
          hint: 'Check the DOI, or search by title instead.',
        });
      }

      const internal = await completeInternalEdges(result.nodes, result.edges);
      const edges = [...result.edges, ...internal];
      await persist(result.nodes, edges);
      await scoreFragment(result.nodes, edges);

      graph = await getPaperGraph(doi, options);
    }

    if (!graph) {
      return apiError(404, 'Paper not found', {
        detail: `${doi} is not in the corpus.`,
        hint: allowCrawl
          ? 'It could not be retrieved from OpenAlex either.'
          : 'Retry without crawl=false to fetch it live.',
      });
    }

    return NextResponse.json(graph, {
      headers: {
        'Cache-Control': `public, s-maxage=${cache.graphTtl}, stale-while-revalidate=${cache.graphTtl * 2}`,
      },
    });
  }, { scope: 'graph' });
}
