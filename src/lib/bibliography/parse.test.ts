import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectFormat,
  extractAllDois,
  extractDoi,
  parseBibliography,
} from './parse';

describe('extractDoi', () => {
  it('pulls a bare DOI', () => {
    assert.equal(extractDoi('10.1038/nature04533'), '10.1038/nature04533');
  });

  it('pulls a DOI out of a URL', () => {
    assert.equal(extractDoi('https://doi.org/10.1038/nature04533'), '10.1038/nature04533');
    assert.equal(extractDoi('http://dx.doi.org/10.1038/nature04533'), '10.1038/nature04533');
  });

  it('strips trailing punctuation from prose', () => {
    // The classic failure: a DOI at the end of a sentence.
    assert.equal(extractDoi('See doi:10.1038/nature04533.'), '10.1038/nature04533');
    assert.equal(extractDoi('(10.1038/nature04533)'), '10.1038/nature04533');
    assert.equal(extractDoi('[10.1038/nature04533],'), '10.1038/nature04533');
  });

  it('lowercases for consistent matching', () => {
    assert.equal(extractDoi('10.1038/NATURE04533'), '10.1038/nature04533');
  });

  it('returns null when there is no DOI', () => {
    assert.equal(extractDoi('Smith et al., Nature, 2006'), null);
    assert.equal(extractDoi(''), null);
    assert.equal(extractDoi('10.1038'), null);
  });

  it('finds every distinct DOI in a blob', () => {
    const found = extractAllDois(`
      10.1038/nature04533 and 10.1126/science.1566067
      duplicate: 10.1038/nature04533
    `);
    assert.deepEqual(found, ['10.1038/nature04533', '10.1126/science.1566067']);
  });
});

describe('detectFormat', () => {
  it('recognises BibTeX', () => {
    assert.equal(detectFormat('@article{lesne2006,\n title={A specific...}\n}'), 'bibtex');
  });

  it('recognises RIS', () => {
    assert.equal(detectFormat('TY  - JOUR\nTI  - A specific amyloid\nER  - '), 'ris');
  });

  it('recognises a plain DOI list', () => {
    assert.equal(detectFormat('10.1038/nature04533\n10.1126/science.1566067'), 'doi-list');
  });

  it('falls back to freetext for a pasted reference list', () => {
    assert.equal(
      detectFormat('1. Lesné S, et al. A specific amyloid-beta protein assembly. Nature. 2006.'),
      'freetext',
    );
  });

  it('treats empty input as freetext rather than throwing', () => {
    assert.equal(detectFormat(''), 'freetext');
    assert.equal(detectFormat('   \n  '), 'freetext');
  });
});

describe('parseBibliography — BibTeX', () => {
  const bib = `
@article{lesne2006specific,
  title = {A specific amyloid-beta protein assembly in the brain impairs memory},
  author = {Lesn{\\'e}, Sylvain and Koh, Ming Teng},
  journal = {Nature},
  year = {2006},
  doi = {10.1038/nature04533}
}

@article{other2019,
  title = {Another paper with a nested {Brace} in the title},
  year = {2019},
  url = {https://doi.org/10.1126/science.1566067}
}
`;

  it('extracts one entry per record', () => {
    const result = parseBibliography(bib);
    assert.equal(result.format, 'bibtex');
    assert.equal(result.entries.length, 2);
  });

  it('reads the doi field', () => {
    const result = parseBibliography(bib);
    assert.equal(result.entries[0].doi, '10.1038/nature04533');
  });

  it('falls back to the url field when there is no doi field', () => {
    const result = parseBibliography(bib);
    assert.equal(result.entries[1].doi, '10.1126/science.1566067');
  });

  it('keeps the citation key so users can match rows back', () => {
    const result = parseBibliography(bib);
    assert.equal(result.entries[0].key, 'lesne2006specific');
  });

  it('handles nested braces in a title', () => {
    const result = parseBibliography(bib);
    assert.equal(
      result.entries[1].title,
      'Another paper with a nested Brace in the title',
    );
  });

  it('reads the year', () => {
    const result = parseBibliography(bib);
    assert.equal(result.entries[0].year, 2006);
    assert.equal(result.entries[1].year, 2019);
  });

  it('accepts quoted field values', () => {
    const result = parseBibliography('@article{k, title = "Quoted title", doi = "10.1/x"}');
    assert.equal(result.entries[0].title, 'Quoted title');
    assert.equal(result.entries[0].doi, null, 'a malformed DOI should not be accepted');
  });
});

describe('parseBibliography — RIS', () => {
  const ris = `
TY  - JOUR
TI  - A specific amyloid-beta protein assembly in the brain impairs memory
AU  - Lesné, Sylvain
PY  - 2006
DO  - 10.1038/nature04533
ER  -

TY  - JOUR
TI  - Second record
UR  - https://doi.org/10.1126/science.1566067
Y1  - 2019/03/15
ER  -
`;

  it('splits on ER and reads DO', () => {
    const result = parseBibliography(ris);
    assert.equal(result.format, 'ris');
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].doi, '10.1038/nature04533');
    assert.equal(
      result.entries[0].title,
      'A specific amyloid-beta protein assembly in the brain impairs memory',
    );
    assert.equal(result.entries[0].year, 2006);
  });

  it('falls back to the UR tag', () => {
    const result = parseBibliography(ris);
    assert.equal(result.entries[1].doi, '10.1126/science.1566067');
    assert.equal(result.entries[1].year, 2019);
  });
});

describe('parseBibliography — DOI list and free text', () => {
  it('parses one DOI per line', () => {
    const result = parseBibliography('10.1038/nature04533\nhttps://doi.org/10.1126/science.1566067');
    assert.equal(result.format, 'doi-list');
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[1].doi, '10.1126/science.1566067');
  });

  it('parses a numbered reference list pasted from a manuscript', () => {
    const text = `1. Lesné S, Koh MT, et al. A specific amyloid-beta protein assembly in the brain impairs memory. Nature. 2006;440:352-357. doi:10.1038/nature04533
2. Someone E. A paper with no DOI at all. Journal of Things. 2019;1:1-2.`;
    const result = parseBibliography(text);
    assert.equal(result.format, 'freetext');
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].doi, '10.1038/nature04533');
    assert.equal(result.entries[1].doi, null);
    assert.equal(result.unidentified, 1);
  });

  it('counts entries it could not identify', () => {
    const result = parseBibliography('No DOI here\nNor here');
    assert.equal(result.unidentified, result.entries.length);
  });
});

describe('parseBibliography — robustness', () => {
  it('never throws on empty input', () => {
    const result = parseBibliography('');
    assert.equal(result.entries.length, 0);
    assert.equal(result.unidentified, 0);
  });

  it('recovers DOIs from a truncated BibTeX file', () => {
    // A file cut off mid-entry still has usable information in it.
    const result = parseBibliography('@article{broken,\n  doi = {10.1038/nature04533},\n  title = {Unclos');
    assert.equal(result.entries[0].doi, '10.1038/nature04533');
  });

  it('sweeps for DOIs when the detected parser finds none', () => {
    // Looks like BibTeX, but the DOI is somewhere the field parser misses.
    const result = parseBibliography('@misc{x}\n\nstray 10.1038/nature04533 in a comment');
    assert.ok(result.entries.some((e) => e.doi === '10.1038/nature04533'));
  });

  it('handles a large list without pathological slowdown', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `10.1234/test.${i}`);
    const started = Date.now();
    const result = parseBibliography(lines.join('\n'));
    assert.equal(result.entries.length, 2000);
    assert.ok(Date.now() - started < 2000, 'parsing 2000 DOIs should be fast');
  });

  it('respects an explicitly supplied format', () => {
    const result = parseBibliography('10.1038/nature04533', 'freetext');
    assert.equal(result.format, 'freetext');
    assert.equal(result.entries[0].doi, '10.1038/nature04533');
  });
});
