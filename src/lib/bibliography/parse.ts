/**
 * Bibliography parsing.
 *
 * People arrive with whatever their reference manager exported: a BibTeX file,
 * an RIS file, a pasted reference list from a manuscript, or just a column of
 * DOIs. Making them convert first would defeat the point, so this accepts all
 * of them and extracts what it actually needs — a DOI per entry, plus enough
 * title text to report unresolved entries usefully.
 *
 * Everything here is pure and synchronous so it can be unit tested without
 * fixtures on disk and run client-side for an instant preview.
 */

export interface ParsedEntry {
  /** The raw text this entry came from, echoed back so users can match rows. */
  raw: string;
  doi: string | null;
  title: string | null;
  /** Citation key or record number, when the format supplies one. */
  key: string | null;
  year: number | null;
}

export type BibliographyFormat = 'bibtex' | 'ris' | 'doi-list' | 'freetext';

export interface ParseResult {
  format: BibliographyFormat;
  entries: ParsedEntry[];
  /** Entries the parser saw but could not extract any identifier from. */
  unidentified: number;
}

/**
 * DOI matcher.
 *
 * Deliberately permissive about the suffix — DOIs may contain almost anything —
 * then trimmed of trailing punctuation, which is what actually goes wrong when
 * a DOI is pulled out of running prose or a LaTeX field.
 */
const DOI_PATTERN = /\b(10\.\d{4,9}\/[^\s"'<>,;)\]}]+)/gi;

export function extractDoi(text: string): string | null {
  DOI_PATTERN.lastIndex = 0;
  const match = DOI_PATTERN.exec(text);
  if (!match) return null;
  return cleanDoi(match[1]);
}

export function extractAllDois(text: string): string[] {
  DOI_PATTERN.lastIndex = 0;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = DOI_PATTERN.exec(text)) !== null) {
    const cleaned = cleanDoi(match[1]);
    if (cleaned) found.push(cleaned);
  }
  return [...new Set(found)];
}

function cleanDoi(raw: string): string | null {
  // Trailing punctuation is almost never part of the DOI; a trailing closing
  // brace usually is not either, since BibTeX wraps the field.
  const cleaned = raw
    .replace(/[.,;:)\]}>]+$/, '')
    .replace(/\\_/g, '_')
    .trim()
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(cleaned) ? cleaned : null;
}

/** Detect which format a blob is in, so callers do not have to say. */
export function detectFormat(input: string): BibliographyFormat {
  const text = input.trim();
  if (!text) return 'freetext';
  if (/^\s*@\w+\s*\{/m.test(text)) return 'bibtex';
  if (/^\s*TY\s+-\s+/m.test(text)) return 'ris';

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Every non-empty line is just an identifier: treat as a plain DOI list.
  const doiLines = lines.filter((l) => extractDoi(l) !== null && l.length < 120);
  if (lines.length > 0 && doiLines.length === lines.length) return 'doi-list';

  return 'freetext';
}

/** Extract a `field = {value}` or `field = "value"` pair from a BibTeX entry. */
function bibtexField(entry: string, field: string): string | null {
  const pattern = new RegExp(`\\b${field}\\s*=\\s*`, 'i');
  const match = pattern.exec(entry);
  if (!match) return null;

  let index = match.index + match[0].length;
  const opener = entry[index];

  if (opener === '{') {
    // Track brace depth: BibTeX values legitimately nest braces.
    let depth = 0;
    const start = index + 1;
    for (; index < entry.length; index += 1) {
      if (entry[index] === '{') depth += 1;
      else if (entry[index] === '}') {
        depth -= 1;
        if (depth === 0) return entry.slice(start, index).trim();
      }
    }
    return entry.slice(start).trim();
  }

  if (opener === '"') {
    const end = entry.indexOf('"', index + 1);
    return end === -1 ? null : entry.slice(index + 1, end).trim();
  }

  const rest = entry.slice(index);
  const end = rest.search(/[,\n}]/);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

function cleanTitle(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/[{}]/g, '')
    .replace(/\\[a-zA-Z]+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

function parseBibtex(input: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  // Split on @type{ at line starts; the lookahead keeps the delimiter.
  const chunks = input.split(/(?=^\s*@\w+\s*\{)/m).filter((c) => /@\w+\s*\{/.test(c));

  for (const chunk of chunks) {
    const keyMatch = /@\w+\s*\{\s*([^,\s]+)\s*,/.exec(chunk);
    const doiField = bibtexField(chunk, 'doi');
    const urlField = bibtexField(chunk, 'url');
    const yearField = bibtexField(chunk, 'year');

    entries.push({
      raw: chunk.trim(),
      // Fall back to the URL field: many exports put the DOI only there.
      doi: (doiField ? cleanDoi(doiField) : null) ?? extractDoi(urlField ?? '') ?? extractDoi(chunk),
      title: cleanTitle(bibtexField(chunk, 'title')),
      key: keyMatch ? keyMatch[1] : null,
      year: yearField && /^\d{4}$/.test(yearField.trim()) ? Number(yearField.trim()) : null,
    });
  }

  return entries;
}

function parseRis(input: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const records = input.split(/^\s*ER\s+-.*$/m).filter((r) => /TY\s+-/.test(r));

  for (const record of records) {
    const fields = new Map<string, string[]>();
    for (const line of record.split(/\r?\n/)) {
      const match = /^([A-Z][A-Z0-9])\s+-\s*(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, tag, value] = match;
      const list = fields.get(tag);
      if (list) list.push(value.trim());
      else fields.set(tag, [value.trim()]);
    }

    const first = (tag: string) => fields.get(tag)?.[0] ?? null;
    // DO is the canonical DOI tag; UR and L3 are common fallbacks.
    const doiRaw = first('DO') ?? first('L3');
    const year = first('PY') ?? first('Y1');

    entries.push({
      raw: record.trim(),
      doi:
        (doiRaw ? cleanDoi(doiRaw) : null) ??
        extractDoi(first('UR') ?? '') ??
        extractDoi(record),
      title: cleanTitle(first('TI') ?? first('T1') ?? first('BT')),
      key: first('ID'),
      year: year && /\d{4}/.test(year) ? Number(/(\d{4})/.exec(year)![1]) : null,
    });
  }

  return entries;
}

function parseDoiList(input: string): ParsedEntry[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      raw: line,
      doi: extractDoi(line),
      title: null,
      key: null,
      year: null,
    }));
}

/**
 * Free text: a reference list pasted out of a manuscript.
 *
 * Split on blank lines first; if that yields one blob, fall back to numbered
 * or newline-separated entries. Any line carrying a DOI becomes an entry.
 */
function parseFreeText(input: string): ParsedEntry[] {
  const blocks = input
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const candidates =
    blocks.length > 1
      ? blocks
      : input
          .split(/\r?\n(?=\s*(?:\[\d+\]|\d+[.)]\s))|\r?\n/)
          .map((b) => b.trim())
          .filter(Boolean);

  return candidates.map((block) => {
    const yearMatch = /\b(19|20)\d{2}\b/.exec(block);
    return {
      raw: block,
      doi: extractDoi(block),
      title: null,
      key: null,
      year: yearMatch ? Number(yearMatch[0]) : null,
    };
  });
}

/**
 * Parse a bibliography in any supported format.
 *
 * Never throws on malformed input: a reference list is user data, and a single
 * broken entry must not cost someone the other two hundred.
 */
export function parseBibliography(
  input: string,
  format?: BibliographyFormat,
): ParseResult {
  const text = input ?? '';
  const detected = format ?? detectFormat(text);

  let entries: ParsedEntry[];
  try {
    switch (detected) {
      case 'bibtex': entries = parseBibtex(text); break;
      case 'ris': entries = parseRis(text); break;
      case 'doi-list': entries = parseDoiList(text); break;
      default: entries = parseFreeText(text); break;
    }
  } catch {
    // Fall back to scraping DOIs out of the raw blob rather than failing.
    entries = extractAllDois(text).map((doi) => ({
      raw: doi, doi, title: null, key: null, year: null,
    }));
  }

  // A structured file with no DOIs anywhere is more likely mis-detected than
  // genuinely empty, so sweep the raw text before giving up.
  if (entries.every((e) => e.doi === null)) {
    const sweep = extractAllDois(text);
    if (sweep.length) {
      entries = sweep.map((doi) => ({
        raw: doi, doi, title: null, key: null, year: null,
      }));
    }
  }

  return {
    format: detected,
    entries,
    unidentified: entries.filter((e) => e.doi === null).length,
  };
}
