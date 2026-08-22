import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  csvCell,
  exportFilename,
  papersToRows,
  toBibtex,
  toCsv,
  toGraphml,
  toRis,
} from './formats';
import type { PaperNode } from '../types';

function paper(over: Partial<PaperNode> = {}): PaperNode {
  return {
    id: 'https://openalex.org/W1',
    doi: '10.1038/nature04533',
    title: 'A specific amyloid-beta protein assembly',
    publicationYear: 2006,
    publicationDate: '2006-03-15',
    type: 'article',
    venue: 'Nature',
    authors: [{ name: 'Sylvain Lesné' }, { name: 'Ming Teng Koh' }],
    concepts: ['Neurodegeneration'],
    citedByCount: 2758,
    referencedCount: 32,
    status: 'clean',
    retracted: false,
    retraction: null,
    contamination: null,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    sources: ['openalex'],
    ...over,
  };
}

describe('csvCell', () => {
  it('quotes cells containing commas, quotes or newlines', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  });

  it('neutralises formula injection', () => {
    // Paper titles are attacker-influenced text and Excel executes these.
    assert.equal(csvCell('=cmd|calc'), "'=cmd|calc");
    assert.equal(csvCell('+1+1'), "'+1+1");
    assert.equal(csvCell('-2+3'), "'-2+3");
    assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  });

  it('passes ordinary values through untouched', () => {
    assert.equal(csvCell('Nature'), 'Nature');
    assert.equal(csvCell(2006), '2006');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
  });
});

describe('toCsv', () => {
  it('emits a header row and one row per record', () => {
    const csv = toCsv([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    const lines = csv.split('\r\n');
    assert.equal(lines[0], 'a,b');
    assert.equal(lines.length, 3);
  });

  it('unions headers across heterogeneous rows', () => {
    const csv = toCsv([{ a: 1 }, { b: 2 }]);
    assert.equal(csv.split('\r\n')[0], 'a,b');
  });

  it('returns empty string for no rows', () => {
    assert.equal(toCsv([]), '');
  });
});

describe('papersToRows', () => {
  it('includes the score version so a row is reproducible', () => {
    const rows = papersToRows([
      paper({
        contamination: {
          score: 42.5, dose: 1.2, directHits: 1, totalUpstreamRetractions: 1,
          minHops: 1, postRetractionCitations: 1,
          version: 'geiger-contamination-1.0.0', computedAt: '2026-01-01T00:00:00.000Z',
          citationIntent: null, intentReason: null,
        },
      }),
    ]);
    assert.equal(rows[0].contamination_score, 42.5);
    assert.equal(rows[0].score_version, 'geiger-contamination-1.0.0');
    assert.equal(rows[0].generations_from_flagged, 1);
  });

  it('carries retraction detail, not just a flag', () => {
    const rows = papersToRows([
      paper({
        status: 'retracted',
        retracted: true,
        retraction: {
          noticeDate: '2024-06-24', noticeYear: 2024,
          reasons: ['Image manipulation'], nature: 'retraction',
          noticeUrl: 'https://doi.org/10.1038/x', source: 'retraction-watch',
        },
      }),
    ]);
    assert.equal(rows[0].integrity_status, 'retracted');
    assert.equal(rows[0].retraction_notice_date, '2024-06-24');
    assert.equal(rows[0].retraction_reasons, 'Image manipulation');
  });
});

describe('toGraphml', () => {
  const graph = {
    nodes: [paper(), paper({ id: 'https://openalex.org/W2', doi: '10.1/b', title: 'Second' })],
    edges: [{ source: 'https://openalex.org/W2', target: 'https://openalex.org/W1' }],
  };

  it('produces a directed graph with all nodes and edges', () => {
    const xml = toGraphml(graph);
    assert.match(xml, /edgedefault="directed"/);
    assert.equal((xml.match(/<node /g) ?? []).length, 2);
    assert.equal((xml.match(/<edge /g) ?? []).length, 1);
  });

  it('escapes XML metacharacters in titles', () => {
    const xml = toGraphml({
      nodes: [paper({ title: 'Tau & <amyloid> "interaction"' })],
      edges: [],
    });
    assert.match(xml, /Tau &amp; &lt;amyloid&gt; &quot;interaction&quot;/);
    assert.doesNotMatch(xml, /<amyloid>/);
  });

  it('strips control characters that would make the XML invalid', () => {
    const xml = toGraphml({ nodes: [paper({ title: 'Badtitle' })], edges: [] });
    assert.doesNotMatch(xml, //);
    assert.match(xml, /Badtitle/);
  });

  it('declares a key for every attribute it writes', () => {
    const xml = toGraphml(graph);
    const declared = [...xml.matchAll(/<key id="(d\d+)"/g)].map((m) => m[1]);
    const used = [...new Set([...xml.matchAll(/<data key="(d\d+)"/g)].map((m) => m[1]))];
    for (const key of used) {
      assert.ok(declared.includes(key), `data key ${key} was never declared`);
    }
  });
});

describe('toBibtex', () => {
  it('generates unique keys when authors and years collide', () => {
    const bib = toBibtex([paper(), paper({ id: 'W2', doi: '10.1/b' }), paper({ id: 'W3', doi: '10.1/c' })]);
    const keys = [...bib.matchAll(/@article\{([^,]+),/g)].map((m) => m[1]);
    assert.equal(new Set(keys).size, keys.length, `keys collided: ${keys.join(', ')}`);
  });

  it('strips diacritics from the key but keeps them in the author field', () => {
    const bib = toBibtex([paper()]);
    assert.match(bib, /@article\{lesne2006,/);
    assert.match(bib, /Sylvain Lesné/);
  });

  it('annotates retracted references in a note field', () => {
    const bib = toBibtex([
      paper({
        status: 'retracted',
        retracted: true,
        retraction: { noticeDate: '2024-06-24', reasons: [], source: 'x' },
      }),
    ]);
    assert.match(bib, /note = \{RETRACTED \(notice 2024-06-24\)\}/);
  });

  it('escapes LaTeX special characters', () => {
    const bib = toBibtex([paper({ title: 'Cost & effect of 50% of $x' })]);
    assert.match(bib, /Cost \\& effect of 50\\% of \\\$x/);
  });

  it('joins authors with " and "', () => {
    assert.match(toBibtex([paper()]), /author = \{Sylvain Lesné and Ming Teng Koh\}/);
  });
});

describe('toRis', () => {
  it('writes one AU line per author and terminates the record', () => {
    const ris = toRis([paper()]);
    assert.equal((ris.match(/^AU {2}- /gm) ?? []).length, 2);
    assert.match(ris, /^TY {2}- JOUR$/m);
    assert.match(ris, /^ER {2}- $/m);
    assert.match(ris, /^DO {2}- 10\.1038\/nature04533$/m);
  });
});

describe('exportFilename', () => {
  it('makes a DOI filesystem-safe', () => {
    assert.equal(
      exportFilename('10.1038/nature04533', 'csv'),
      'geiger-10.1038_nature04533.csv',
    );
  });

  it('falls back when there is no DOI', () => {
    assert.equal(exportFilename(null, 'graphml'), 'geiger-geiger-export.graphml');
  });

  it('uses the right extension per format', () => {
    assert.match(exportFilename('10.1/x', 'bibtex'), /\.bib$/);
    assert.match(exportFilename('10.1/x', 'ris'), /\.ris$/);
    assert.match(exportFilename('10.1/x', 'json'), /\.json$/);
  });
});
