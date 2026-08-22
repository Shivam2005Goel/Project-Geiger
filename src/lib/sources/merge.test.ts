import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mergeIntegrity, mostSevere } from './merge';
import type { IntegrityStatus, RetractionRecord } from '../types';

const rec = (over: Partial<RetractionRecord> = {}): RetractionRecord => ({
  reasons: [], ...over,
});

describe('mostSevere', () => {
  it('ranks the ladder correctly', () => {
    assert.equal(mostSevere('clean', 'corrected'), 'corrected');
    assert.equal(mostSevere('corrected', 'concerned'), 'concerned');
    assert.equal(mostSevere('concerned', 'retracted'), 'retracted');
    assert.equal(mostSevere('retracted', 'clean'), 'retracted');
  });

  it('ignores null and undefined', () => {
    assert.equal(mostSevere(null, undefined, 'concerned'), 'concerned');
    assert.equal(mostSevere(null, undefined), 'clean');
  });
});

describe('mergeIntegrity', () => {
  it('never downgrades a retraction to an expression of concern', () => {
    // The Lesné case: OpenAlex knows about the 2024 retraction, Crossref only
    // holds the 2022 expression of concern. Taking Crossref at face value
    // silently unretracts the paper.
    const merged = mergeIntegrity(
      { status: 'retracted', record: rec({ source: 'openalex' }) },
      {
        status: 'concerned',
        record: rec({ noticeDate: '2022-07-14', noticeYear: 2022, source: 'retraction-watch' }),
      },
    );

    assert.equal(merged.status, 'retracted');
    assert.equal(merged.conflicted, true);
  });

  it('adopts the notice date even when the severer status came from elsewhere', () => {
    const merged = mergeIntegrity(
      { status: 'retracted', record: rec({ source: 'openalex' }) },
      { status: 'concerned', record: rec({ noticeDate: '2022-07-14', noticeYear: 2022 }) },
    );

    // Without this the paper stays undated and every citation to it falls
    // into the "unknown timing" bucket.
    assert.equal(merged.record?.noticeDate, '2022-07-14');
    assert.equal(merged.record?.noticeYear, 2022);
  });

  it('keeps the earliest notice date, not the most severe one', () => {
    // The question the timing weight asks is "was there a public warning yet",
    // and an expression of concern is one.
    const merged = mergeIntegrity(
      { status: 'concerned', record: rec({ noticeDate: '2019-03-01' }) },
      { status: 'retracted', record: rec({ noticeDate: '2024-06-24' }) },
    );

    assert.equal(merged.status, 'retracted');
    assert.equal(merged.record?.noticeDate, '2019-03-01');
  });

  it('upgrades a clean local record when a source reports a retraction', () => {
    const merged = mergeIntegrity(
      { status: 'clean', record: null },
      { status: 'retracted', record: rec({ noticeDate: '2020-01-01' }) },
    );
    assert.equal(merged.status, 'retracted');
    assert.equal(merged.record?.noticeDate, '2020-01-01');
    assert.equal(merged.conflicted, false);
  });

  it('treats a clean response as no information, not as an all-clear', () => {
    const merged = mergeIntegrity(
      { status: 'retracted', record: rec({ noticeDate: '2020-01-01' }) },
      { status: 'clean', record: null },
    );
    assert.equal(merged.status, 'retracted');
    assert.equal(merged.record?.noticeDate, '2020-01-01');
    assert.equal(merged.conflicted, false, 'silence is not a conflict');
  });

  it('returns a null record when everything is clean', () => {
    const merged = mergeIntegrity(
      { status: 'clean', record: null },
      { status: 'clean', record: null },
    );
    assert.equal(merged.status, 'clean');
    assert.equal(merged.record, null);
  });

  it('prefers the label attached to the severest assertion', () => {
    const merged = mergeIntegrity(
      { status: 'concerned', record: rec({ nature: 'expression_of_concern' }) },
      { status: 'retracted', record: rec({ nature: 'retraction' }) },
    );
    assert.equal(merged.record?.nature, 'retraction');
  });

  it('unions reasons from every source', () => {
    const merged = mergeIntegrity(
      { status: 'retracted', record: rec({ reasons: ['Image manipulation'] }) },
      { status: 'retracted', record: rec({ reasons: ['Falsification', 'Image manipulation'] }) },
    );
    assert.deepEqual(
      [...(merged.record?.reasons ?? [])].sort(),
      ['Falsification', 'Image manipulation'],
    );
  });

  it('records which sources contributed', () => {
    const merged = mergeIntegrity(
      { status: 'retracted', record: rec({ source: 'openalex' }) },
      { status: 'concerned', record: rec({ source: 'retraction-watch' }) },
    );
    assert.match(merged.record?.source ?? '', /openalex/);
    assert.match(merged.record?.source ?? '', /retraction-watch/);
  });

  it('handles every status pair without throwing', () => {
    const all: IntegrityStatus[] = ['clean', 'corrected', 'concerned', 'retracted'];
    for (const a of all) {
      for (const b of all) {
        const merged = mergeIntegrity(
          { status: a, record: a === 'clean' ? null : rec({ noticeDate: '2020-01-01' }) },
          { status: b, record: b === 'clean' ? null : rec({ noticeDate: '2021-01-01' }) },
        );
        assert.equal(merged.status, mostSevere(a, b), `${a} + ${b}`);
      }
    }
  });
});
