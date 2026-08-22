/**
 * Export formats.
 *
 * A research tool whose output cannot leave it is a demo. These cover the three
 * things people actually do next: open the graph in Gephi or Cytoscape Desktop,
 * pull flagged references back into a reference manager, and put a table in a
 * spreadsheet.
 *
 * All pure string builders, so they are testable and run identically on the
 * server (for an API download) and in the browser (for a client-side save).
 */

import type { CitationEdge, PaperGraph, PaperNode } from '../types';
import { bandFor, BAND_LABELS } from '../scoring/contamination';

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Escape one CSV cell.
 *
 * The leading-character guard is a security measure, not a formatting one: a
 * cell beginning `=`, `+`, `-` or `@` is executed as a formula by Excel and
 * Sheets, and paper titles are attacker-influenced text.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/["\n\r,]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(','));
  }
  // CRLF: Excel is still the most common destination.
  return lines.join('\r\n');
}

/** Flatten papers into the tabular shape people expect in a spreadsheet. */
export function papersToRows(papers: PaperNode[]): Record<string, unknown>[] {
  return papers.map((p) => ({
    doi: p.doi ?? '',
    openalex_id: p.id,
    title: p.title ?? '',
    authors: p.authors.map((a) => a.name).join('; '),
    venue: p.venue ?? '',
    publication_year: p.publicationYear ?? '',
    publication_date: p.publicationDate ?? '',
    cited_by_count: p.citedByCount,
    reference_count: p.referencedCount,
    integrity_status: p.status,
    retraction_notice_date: p.retraction?.noticeDate ?? '',
    retraction_reasons: p.retraction?.reasons.join('; ') ?? '',
    retraction_notice_url: p.retraction?.noticeUrl ?? '',
    contamination_score: p.contamination?.score ?? '',
    contamination_band: BAND_LABELS[bandFor(p.contamination)],
    generations_from_flagged: p.contamination?.minHops ?? '',
    direct_flagged_citations: p.contamination?.directHits ?? '',
    post_notice_citations: p.contamination?.postRetractionCitations ?? '',
    citation_intent: p.contamination?.citationIntent ?? '',
    score_version: p.contamination?.version ?? '',
    data_sources: p.sources.join('; '),
  }));
}

/* ------------------------------------------------------------------ */
/* GraphML — Gephi, Cytoscape Desktop, yEd                             */
/* ------------------------------------------------------------------ */

function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are illegal in XML 1.0 and appear in real titles.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

const GRAPHML_NODE_KEYS: { id: string; name: string; type: string }[] = [
  { id: 'd0', name: 'title', type: 'string' },
  { id: 'd1', name: 'doi', type: 'string' },
  { id: 'd2', name: 'year', type: 'int' },
  { id: 'd3', name: 'status', type: 'string' },
  { id: 'd4', name: 'contaminationScore', type: 'double' },
  { id: 'd5', name: 'generationsFromFlagged', type: 'int' },
  { id: 'd6', name: 'citedByCount', type: 'int' },
  { id: 'd7', name: 'venue', type: 'string' },
  { id: 'd8', name: 'authors', type: 'string' },
];

export function toGraphml(graph: { nodes: PaperNode[]; edges: CitationEdge[] }): string {
  const keys = GRAPHML_NODE_KEYS.map(
    (k) => `  <key id="${k.id}" for="node" attr.name="${k.name}" attr.type="${k.type}"/>`,
  ).join('\n');

  const nodes = graph.nodes
    .map((n) => {
      const values = [
        n.title, n.doi, n.publicationYear, n.status,
        n.contamination?.score ?? 0, n.contamination?.minHops ?? '',
        n.citedByCount, n.venue, n.authors.map((a) => a.name).join('; '),
      ];
      const data = GRAPHML_NODE_KEYS.map((k, i) =>
        values[i] === null || values[i] === undefined || values[i] === ''
          ? ''
          : `      <data key="${k.id}">${xmlEscape(values[i])}</data>`,
      ).filter(Boolean).join('\n');
      return `    <node id="${xmlEscape(n.id)}">\n${data}\n    </node>`;
    })
    .join('\n');

  const edges = graph.edges
    .map(
      (e, i) =>
        `    <edge id="e${i}" source="${xmlEscape(e.source)}" target="${xmlEscape(e.target)}"/>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns
         http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">
${keys}
  <graph id="G" edgedefault="directed">
${nodes}
${edges}
  </graph>
</graphml>`;
}

/* ------------------------------------------------------------------ */
/* BibTeX and RIS — back into a reference manager                      */
/* ------------------------------------------------------------------ */

/** Build a stable, collision-free BibTeX citation key. */
function bibtexKey(paper: PaperNode, taken: Set<string>): string {
  const surname = paper.authors[0]?.name.split(/\s+/).pop() ?? 'anon';
  const base = `${surname}${paper.publicationYear ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase() || 'ref';

  let key = base;
  let suffix = 0;
  while (taken.has(key)) {
    suffix += 1;
    key = `${base}${String.fromCharCode(96 + suffix)}`;
  }
  taken.add(key);
  return key;
}

function bibtexEscape(value: string): string {
  return value.replace(/[{}]/g, '').replace(/([&%$#_])/g, '\\$1');
}

/**
 * Export papers as BibTeX, annotated with integrity status.
 *
 * The annotation goes in a `note` field so it survives a round trip through a
 * reference manager and shows up in the rendered bibliography — a flag nobody
 * sees is not much of a flag.
 */
export function toBibtex(papers: PaperNode[]): string {
  const taken = new Set<string>();

  return papers
    .map((paper) => {
      const key = bibtexKey(paper, taken);
      const fields: [string, string][] = [];

      if (paper.title) fields.push(['title', bibtexEscape(paper.title)]);
      if (paper.authors.length) {
        fields.push(['author', paper.authors.map((a) => bibtexEscape(a.name)).join(' and ')]);
      }
      if (paper.venue) fields.push(['journal', bibtexEscape(paper.venue)]);
      if (paper.publicationYear) fields.push(['year', String(paper.publicationYear)]);
      if (paper.doi) fields.push(['doi', paper.doi]);

      const notes: string[] = [];
      if (paper.status !== 'clean') {
        notes.push(
          `${paper.status.toUpperCase()}${
            paper.retraction?.noticeDate ? ` (notice ${paper.retraction.noticeDate})` : ''
          }`,
        );
      }
      if ((paper.contamination?.score ?? 0) > 0 && paper.status === 'clean') {
        notes.push(`Geiger contamination score ${paper.contamination!.score}`);
      }
      if (notes.length) fields.push(['note', bibtexEscape(notes.join('; '))]);

      const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(',\n');
      return `@article{${key},\n${body}\n}`;
    })
    .join('\n\n');
}

export function toRis(papers: PaperNode[]): string {
  return papers
    .map((paper) => {
      const lines = ['TY  - JOUR'];
      if (paper.title) lines.push(`TI  - ${paper.title}`);
      for (const author of paper.authors) lines.push(`AU  - ${author.name}`);
      if (paper.venue) lines.push(`JO  - ${paper.venue}`);
      if (paper.publicationYear) lines.push(`PY  - ${paper.publicationYear}`);
      if (paper.doi) lines.push(`DO  - ${paper.doi}`);
      if (paper.status !== 'clean') {
        lines.push(`N1  - ${paper.status.toUpperCase()}${
          paper.retraction?.noticeDate ? ` notice ${paper.retraction.noticeDate}` : ''
        }`);
      }
      lines.push('ER  - ');
      return lines.join('\n');
    })
    .join('\n\n');
}

/* ------------------------------------------------------------------ */
/* JSON — the full record, for reproducibility                         */
/* ------------------------------------------------------------------ */

/**
 * The archival export: everything, including the model version and the
 * generation timestamp, so a result quoted in a paper can be reproduced.
 */
export function toJson(graph: PaperGraph): string {
  return JSON.stringify(
    {
      geiger: {
        exportedAt: new Date().toISOString(),
        scoreVersion: graph.nodes[0]?.contamination?.version ?? null,
        meta: graph.meta,
      },
      root: graph.root,
      nodes: graph.nodes,
      edges: graph.edges,
    },
    null,
    2,
  );
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

export type ExportFormat = 'csv' | 'graphml' | 'bibtex' | 'ris' | 'json';

export const EXPORT_META: Record<ExportFormat, { extension: string; mime: string; label: string }> = {
  csv: { extension: 'csv', mime: 'text/csv;charset=utf-8', label: 'CSV (spreadsheet)' },
  graphml: { extension: 'graphml', mime: 'application/xml', label: 'GraphML (Gephi, Cytoscape)' },
  bibtex: { extension: 'bib', mime: 'application/x-bibtex', label: 'BibTeX' },
  ris: { extension: 'ris', mime: 'application/x-research-info-systems', label: 'RIS (EndNote, Zotero)' },
  json: { extension: 'json', mime: 'application/json', label: 'JSON (full record)' },
};

export function renderExport(format: ExportFormat, graph: PaperGraph): string {
  switch (format) {
    case 'csv': return toCsv(papersToRows(graph.nodes));
    case 'graphml': return toGraphml(graph);
    case 'bibtex': return toBibtex(graph.nodes);
    case 'ris': return toRis(graph.nodes);
    case 'json': return toJson(graph);
  }
}

/** Filesystem-safe filename stem derived from a DOI. */
export function exportFilename(doi: string | null, format: ExportFormat): string {
  const stem = (doi ?? 'geiger-export').replace(/[^A-Za-z0-9._-]+/g, '_');
  return `geiger-${stem}.${EXPORT_META[format].extension}`;
}
