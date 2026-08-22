import { search } from '@/lib/db/queries/search';
import { cached, guarded, parseInt as parseIntParam } from '@/lib/api/guard';
import { cache, limits } from '@/lib/config';

export const runtime = 'nodejs';

/**
 * Search by DOI, OpenAlex ID, PMID, arXiv ID, title or author.
 *
 * Local corpus first, then OpenAlex. Results carry an `inDatabase` flag so the
 * UI can distinguish "we have analysed this" from "we found it upstream and
 * can fetch it on request" — a distinction that matters, because only the
 * first kind has a contamination score behind it.
 */
export async function GET(request: Request) {
  return guarded(request, async () => {
    const url = new URL(request.url);
    const query = (url.searchParams.get('q') ?? '').trim();
    const limit = parseIntParam(url.searchParams.get('limit'), {
      min: 1, max: 50, fallback: limits.searchLimit, name: 'limit',
    });
    const localOnly = url.searchParams.get('localOnly') === 'true';

    if (!query) {
      return cached({ results: [], source: 'local', query }, 60);
    }

    const { results, source } = await search(query, { limit, localOnly });
    return cached({ results, source, query }, cache.searchTtl);
  }, { scope: 'search' });
}
