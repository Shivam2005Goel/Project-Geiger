import { NextResponse } from 'next/server';
import { checkBibliography } from '@/lib/bibliography/check';
import { parseBibliography, type BibliographyFormat } from '@/lib/bibliography/parse';
import { apiError, guarded, ValidationError } from '@/lib/api/guard';
import { limits, rateLimit } from '@/lib/config';

export const runtime = 'nodejs';
// Deep checks fan out to OpenAlex and Crossref one DOI at a time.
export const maxDuration = 300;

const VALID_FORMATS: BibliographyFormat[] = ['bibtex', 'ris', 'doi-list', 'freetext'];

/**
 * Check a bibliography for retracted and contaminated references.
 *
 * Accepts a raw BibTeX/RIS/DOI-list/pasted-references blob, or a JSON array of
 * DOIs. Gets its own, much tighter rate limit than the read endpoints: a deep
 * check can issue hundreds of upstream lookups.
 */
export async function POST(request: Request) {
  return guarded(
    request,
    async () => {
      const contentType = request.headers.get('content-type') ?? '';
      let text = '';
      let format: BibliographyFormat | undefined;
      let deep = false;

      if (contentType.includes('application/json')) {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          throw new ValidationError(
            'Request body must be JSON',
            'Send { "text": "...", "format": "bibtex", "deep": false } or { "dois": [...] }.',
          );
        }

        const payload = body as Record<string, unknown>;
        deep = payload.deep === true;

        if (Array.isArray(payload.dois)) {
          text = payload.dois.filter((d) => typeof d === 'string').join('\n');
          format = 'doi-list';
        } else if (typeof payload.text === 'string') {
          text = payload.text;
          if (typeof payload.format === 'string') {
            if (!VALID_FORMATS.includes(payload.format as BibliographyFormat)) {
              throw new ValidationError(
                `Unknown format "${payload.format}"`,
                `Valid values: ${VALID_FORMATS.join(', ')}, or omit to auto-detect.`,
              );
            }
            format = payload.format as BibliographyFormat;
          }
        } else {
          throw new ValidationError(
            'No bibliography supplied',
            'Provide either "text" or a "dois" array.',
          );
        }
      } else {
        text = await request.text();
        deep = new URL(request.url).searchParams.get('deep') === 'true';
      }

      if (!text.trim()) {
        throw new ValidationError(
          'The bibliography is empty',
          'Paste references, or upload a .bib or .ris file.',
        );
      }

      // Guard before parsing: a huge paste should be rejected cheaply.
      if (text.length > 2_000_000) {
        return apiError(413, 'Bibliography too large', {
          hint: 'Split it into files under 2 MB and check them separately.',
        });
      }

      const parsed = parseBibliography(text, format);
      if (!parsed.entries.length) {
        throw new ValidationError(
          'No references found',
          'Geiger looks for DOIs. Make sure your entries include them.',
        );
      }

      const report = await checkBibliography(parsed.entries, {
        resolveRemote: deep,
        maxRemote: 200,
      });

      return NextResponse.json({
        ...report,
        input: {
          detectedFormat: parsed.format,
          entriesParsed: parsed.entries.length,
          entriesWithoutDoi: parsed.unidentified,
          truncated: parsed.entries.length > limits.maxBibliographyEntries,
          deepCheck: deep,
        },
      });
    },
    { scope: 'bibliography', max: rateLimit.maxBibliographyRequests },
  );
}
