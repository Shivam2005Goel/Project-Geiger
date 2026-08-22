import { getPaperGraph } from '@/lib/db/queries/paper';
import {
  EXPORT_META,
  exportFilename,
  renderExport,
  type ExportFormat,
} from '@/lib/export/formats';
import { apiError, guarded, parseDoi, parseGraphParams, ValidationError } from '@/lib/api/guard';

export const runtime = 'nodejs';

const FORMATS = Object.keys(EXPORT_META) as ExportFormat[];

/**
 * Download a paper's citation neighbourhood in an interchange format.
 *
 * Server-side rather than client-side so the export reflects the full queried
 * graph rather than whatever the browser happened to have rendered, and so it
 * can be scripted — `curl` against this endpoint is a legitimate way to use
 * Geiger.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ doi: string[] }> },
) {
  return guarded(request, async () => {
    const { doi: segments } = await params;
    const doi = parseDoi(segments);
    const url = new URL(request.url);

    const requested = (url.searchParams.get('format') ?? 'csv').toLowerCase();
    if (!FORMATS.includes(requested as ExportFormat)) {
      throw new ValidationError(
        `Unknown export format "${requested}"`,
        `Valid values: ${FORMATS.join(', ')}.`,
      );
    }
    const format = requested as ExportFormat;

    const graph = await getPaperGraph(doi, parseGraphParams(url));
    if (!graph) {
      return apiError(404, 'Paper not found', {
        detail: `${doi} is not in the corpus.`,
        hint: `Load it first via /api/paper/${encodeURIComponent(doi)}`,
      });
    }

    const body = renderExport(format, graph);

    return new Response(body, {
      headers: {
        'Content-Type': EXPORT_META[format].mime,
        'Content-Disposition': `attachment; filename="${exportFilename(doi, format)}"`,
        // Exports are derived from precomputed scores, so they cache like the
        // graph itself.
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  }, { scope: 'export' });
}
