import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PARAMS,
  bandFor,
  compareToNotice,
  explainPaths,
  normaliseDose,
  relianceWeight,
  scoreGraph,
  severityWeight,
  timingWeight,
  type ScoringEdge,
  type ScoringPaper,
} from './contamination';

const params = DEFAULT_PARAMS;
const now = () => new Date('2026-01-01T00:00:00.000Z');

function paper(id: string, overrides: Partial<ScoringPaper> = {}): ScoringPaper {
  return {
    id,
    status: 'clean',
    publicationYear: 2020,
    publicationDate: '2020-01-01',
    referencedCount: 30,
    ...overrides,
  };
}

describe('compareToNotice', () => {
  it('orders full dates', () => {
    assert.equal(
      compareToNotice({ date: '2025-03-01' }, { date: '2024-06-01' }),
      'after',
    );
    assert.equal(
      compareToNotice({ date: '2023-03-01' }, { date: '2024-06-01' }),
      'before',
    );
  });

  it('refuses to guess within the same year', () => {
    // A paper published in some month of 2024 against a notice issued in some
    // other month of 2024 is genuinely undecidable from year data alone.
    assert.equal(compareToNotice({ year: 2024 }, { year: 2024 }), 'unknown');
    assert.equal(
      compareToNotice({ date: '2024-03-01' }, { date: '2024-03-01' }),
      'unknown',
    );
  });

  it('falls back to years when either date is partial', () => {
    assert.equal(compareToNotice({ date: '2025-03-01' }, { year: 2024 }), 'after');
    assert.equal(compareToNotice({ year: 2021 }, { date: '2024-06-01' }), 'before');
  });

  it('returns unknown when data is missing', () => {
    assert.equal(compareToNotice({}, { year: 2024 }), 'unknown');
    assert.equal(compareToNotice({ year: 2024 }, {}), 'unknown');
    assert.equal(compareToNotice({}, {}), 'unknown');
  });
});

describe('timingWeight', () => {
  const retracted = paper('R', {
    status: 'retracted',
    retractionDate: '2024-06-01',
    retractionYear: 2024,
  });

  it('gives full weight to citations published after the notice', () => {
    const citing = paper('P', { publicationDate: '2025-02-01', publicationYear: 2025 });
    assert.equal(timingWeight(citing, retracted, params), params.weightPostRetraction);
  });

  it('discounts citations that predate the notice', () => {
    const citing = paper('P', { publicationDate: '2010-02-01', publicationYear: 2010 });
    assert.equal(timingWeight(citing, retracted, params), params.weightPreRetraction);
  });

  it('uses the middle weight when ordering is undecidable', () => {
    const citing = paper('P', { publicationDate: null, publicationYear: null });
    assert.equal(timingWeight(citing, retracted, params), params.weightUnknownTiming);
  });

  it('post-retraction weight strictly exceeds pre-retraction weight', () => {
    // The core claim of the model: citing after a retraction is worse.
    assert.ok(params.weightPostRetraction > params.weightUnknownTiming);
    assert.ok(params.weightUnknownTiming > params.weightPreRetraction);
  });
});

describe('relianceWeight', () => {
  it('gives full weight to short reference lists', () => {
    assert.equal(relianceWeight(8, params), 1);
    assert.equal(relianceWeight(params.referenceBaseline, params), 1);
  });

  it('falls off inversely above the baseline', () => {
    const w = relianceWeight(params.referenceBaseline * 4, params);
    assert.ok(Math.abs(w - 0.25) < 1e-9);
  });

  it('stays within (0, 1] for any input', () => {
    for (const n of [0, 1, 30, 300, 5000]) {
      const w = relianceWeight(n, params);
      assert.ok(w > 0 && w <= 1, `weight ${w} out of range for ${n}`);
    }
    assert.equal(relianceWeight(null, params), 1);
    assert.equal(relianceWeight(undefined, params), 1);
  });
});

describe('normaliseDose', () => {
  it('maps zero dose to zero', () => {
    assert.equal(normaliseDose(0, params), 0);
    assert.equal(normaliseDose(-5, params), 0);
  });

  it('is monotonically increasing', () => {
    let previous = -1;
    for (const dose of [0.1, 0.5, 1, 2, 5, 10, 50]) {
      const score = normaliseDose(dose, params);
      assert.ok(score > previous, `not monotonic at dose ${dose}`);
      previous = score;
    }
  });

  it('saturates below 100 rather than running away', () => {
    assert.ok(normaliseDose(1000, params) <= 100);
    assert.ok(normaliseDose(1000, params) > 99);
  });
});

describe('severityWeight', () => {
  it('ranks statuses by severity and emits nothing for clean papers', () => {
    assert.equal(severityWeight('clean', params), 0);
    assert.ok(severityWeight('corrected', params) < severityWeight('concerned', params));
    assert.ok(severityWeight('concerned', params) < severityWeight('retracted', params));
  });
});

describe('scoreGraph', () => {
  it('scores a clean isolated paper as zero', () => {
    const scores = scoreGraph([paper('A')], [], { now });
    assert.equal(scores.get('A')!.score, 0);
    assert.equal(scores.get('A')!.minHops, null);
  });

  it('pins a retracted paper to 100 as the source, not as a victim', () => {
    const scores = scoreGraph(
      [paper('R', { status: 'retracted', retractionYear: 2024 })],
      [],
      { now },
    );
    const r = scores.get('R')!;
    assert.equal(r.score, 100);
    assert.equal(r.minHops, 0);
  });

  it('propagates dose to a direct citer', () => {
    const papers = [
      paper('R', { status: 'retracted', retractionDate: '2024-06-01', retractionYear: 2024 }),
      paper('A', { publicationDate: '2025-01-01', publicationYear: 2025 }),
    ];
    const edges: ScoringEdge[] = [{ source: 'A', target: 'R' }];
    const a = scoreGraph(papers, edges, { now }).get('A')!;

    assert.ok(a.score > 0);
    assert.equal(a.directHits, 1);
    assert.equal(a.minHops, 1);
    assert.equal(a.totalUpstreamRetractions, 1);
    assert.equal(a.postRetractionCitations, 1);
  });

  it('decays with each generation', () => {
    // R <- A <- B <- C : each one hop further from the retracted source.
    const papers = [
      paper('R', { status: 'retracted', retractionDate: '2024-06-01', retractionYear: 2024 }),
      paper('A', { publicationDate: '2025-01-01', publicationYear: 2025 }),
      paper('B', { publicationDate: '2025-02-01', publicationYear: 2025 }),
      paper('C', { publicationDate: '2025-03-01', publicationYear: 2025 }),
    ];
    const edges: ScoringEdge[] = [
      { source: 'A', target: 'R' },
      { source: 'B', target: 'A' },
      { source: 'C', target: 'B' },
    ];
    const scores = scoreGraph(papers, edges, { now });

    const a = scores.get('A')!.score;
    const b = scores.get('B')!.score;
    const c = scores.get('C')!.score;

    assert.ok(a > b, 'generation 1 should exceed generation 2');
    assert.ok(b > c, 'generation 2 should exceed generation 3');
    assert.equal(scores.get('A')!.minHops, 1);
    assert.equal(scores.get('B')!.minHops, 2);
    assert.equal(scores.get('C')!.minHops, 3);

    // Only A cites the retracted work directly.
    assert.equal(scores.get('A')!.directHits, 1);
    assert.equal(scores.get('B')!.directHits, 0);
  });

  it('stops propagating past maxGenerations', () => {
    const papers = [
      paper('R', { status: 'retracted', retractionYear: 2024 }),
      paper('G1'), paper('G2'), paper('G3'), paper('G4'),
    ];
    const edges: ScoringEdge[] = [
      { source: 'G1', target: 'R' },
      { source: 'G2', target: 'G1' },
      { source: 'G3', target: 'G2' },
      { source: 'G4', target: 'G3' },
    ];
    const scores = scoreGraph(papers, edges, {
      now,
      params: { ...params, maxGenerations: 3 },
    });

    assert.ok(scores.get('G3')!.score > 0);
    assert.equal(scores.get('G4')!.score, 0, 'generation 4 is beyond the horizon');
  });

  it('ranks a post-retraction citer above an otherwise identical earlier one', () => {
    // The single most important behaviour in the model.
    const papers = [
      paper('R', { status: 'retracted', retractionDate: '2015-06-01', retractionYear: 2015 }),
      paper('EARLY', { publicationDate: '2010-01-01', publicationYear: 2010 }),
      paper('LATE', { publicationDate: '2020-01-01', publicationYear: 2020 }),
    ];
    const edges: ScoringEdge[] = [
      { source: 'EARLY', target: 'R' },
      { source: 'LATE', target: 'R' },
    ];
    const scores = scoreGraph(papers, edges, { now });

    assert.ok(
      scores.get('LATE')!.score > scores.get('EARLY')!.score,
      'citing after a retraction must score higher than citing before it',
    );
    assert.equal(scores.get('LATE')!.postRetractionCitations, 1);
    assert.equal(scores.get('EARLY')!.postRetractionCitations, 0);
  });

  it('discounts a paper that buries the citation in a huge reference list', () => {
    const papers = [
      paper('R', { status: 'retracted', retractionYear: 2015 }),
      paper('FOCUSED', { referencedCount: 10 }),
      paper('SPRAWLING', { referencedCount: 600 }),
    ];
    const edges: ScoringEdge[] = [
      { source: 'FOCUSED', target: 'R' },
      { source: 'SPRAWLING', target: 'R' },
    ];
    const scores = scoreGraph(papers, edges, { now });
    assert.ok(scores.get('FOCUSED')!.score > scores.get('SPRAWLING')!.score);
  });

  it('accumulates dose across multiple retracted sources', () => {
    const papers = [
      paper('R1', { status: 'retracted', retractionYear: 2015 }),
      paper('R2', { status: 'retracted', retractionYear: 2016 }),
      paper('ONE'), paper('TWO'),
    ];
    const edges: ScoringEdge[] = [
      { source: 'ONE', target: 'R1' },
      { source: 'TWO', target: 'R1' },
      { source: 'TWO', target: 'R2' },
    ];
    const scores = scoreGraph(papers, edges, { now });

    assert.ok(scores.get('TWO')!.score > scores.get('ONE')!.score);
    assert.equal(scores.get('TWO')!.totalUpstreamRetractions, 2);
    assert.equal(scores.get('ONE')!.totalUpstreamRetractions, 1);
  });

  it('weights an expression of concern below a full retraction', () => {
    const papers = [
      paper('R', { status: 'retracted', retractionYear: 2015 }),
      paper('E', { status: 'concerned', retractionYear: 2015 }),
      paper('CITES_R'), paper('CITES_E'),
    ];
    const edges: ScoringEdge[] = [
      { source: 'CITES_R', target: 'R' },
      { source: 'CITES_E', target: 'E' },
    ];
    const scores = scoreGraph(papers, edges, { now });
    assert.ok(scores.get('CITES_R')!.score > scores.get('CITES_E')!.score);
  });

  it('does not propagate dose upstream into the source bibliography', () => {
    // REF is cited BY the retracted paper. It is not contaminated by it.
    const papers = [
      paper('R', { status: 'retracted', retractionYear: 2015 }),
      paper('REF'),
    ];
    const edges: ScoringEdge[] = [{ source: 'R', target: 'REF' }];
    const scores = scoreGraph(papers, edges, { now });
    assert.equal(scores.get('REF')!.score, 0, 'a retracted paper does not taint its own references');
  });

  it('terminates on cyclic citation data', () => {
    // Real citation data contains cycles (preprint/version artefacts).
    const papers = [
      paper('R', { status: 'retracted', retractionYear: 2015 }),
      paper('A'), paper('B'),
    ];
    const edges: ScoringEdge[] = [
      { source: 'A', target: 'R' },
      { source: 'B', target: 'A' },
      { source: 'A', target: 'B' },
    ];
    const scores = scoreGraph(papers, edges, { now });
    assert.ok(scores.get('A')!.score > 0);
    assert.ok(scores.get('B')!.score > 0);
  });

  it('ignores edges pointing at papers outside the supplied set', () => {
    const papers = [paper('A')];
    const edges: ScoringEdge[] = [{ source: 'A', target: 'MISSING' }];
    const scores = scoreGraph(papers, edges, { now });
    assert.equal(scores.get('A')!.score, 0);
  });

  it('stamps every assessment with the parameter version', () => {
    const scores = scoreGraph([paper('A')], [], { now, version: 'test-1' });
    assert.equal(scores.get('A')!.version, 'test-1');
    assert.equal(scores.get('A')!.computedAt, '2026-01-01T00:00:00.000Z');
  });

  it('produces a score for every paper it is given', () => {
    const papers = [paper('A'), paper('B'), paper('C', { status: 'retracted' })];
    const scores = scoreGraph(papers, [], { now });
    assert.equal(scores.size, 3);
    for (const p of papers) assert.ok(scores.has(p.id));
  });

  it('keeps every score within 0-100', () => {
    const papers: ScoringPaper[] = [paper('TARGET', { referencedCount: 1 })];
    const edges: ScoringEdge[] = [];
    // Pile on fifty retracted sources, all cited after their notices.
    for (let i = 0; i < 50; i += 1) {
      papers.push(paper(`R${i}`, { status: 'retracted', retractionYear: 1990 }));
      edges.push({ source: 'TARGET', target: `R${i}` });
    }
    const score = scoreGraph(papers, edges, { now }).get('TARGET')!.score;
    assert.ok(score > 0 && score <= 100, `score ${score} out of range`);
  });
});

describe('explainPaths', () => {
  it('returns the chain from the retracted source to the affected paper', () => {
    const papers = [
      paper('R', { status: 'retracted', retractionDate: '2015-06-01', retractionYear: 2015 }),
      paper('MID', { publicationYear: 2018 }),
      paper('TARGET', { publicationYear: 2020 }),
    ];
    const edges: ScoringEdge[] = [
      { source: 'MID', target: 'R' },
      { source: 'TARGET', target: 'MID' },
    ];
    const paths = explainPaths('TARGET', papers, edges, {});

    assert.equal(paths.length, 1);
    assert.deepEqual(paths[0].nodeIds, ['R', 'MID', 'TARGET']);
    assert.equal(paths[0].hops, 2);
    assert.ok(paths[0].contribution > 0);
  });

  it('finds a direct citation as a one-hop path', () => {
    const papers = [
      paper('R', { status: 'retracted', retractionYear: 2015 }),
      paper('TARGET', { publicationYear: 2020 }),
    ];
    const paths = explainPaths('TARGET', papers, [{ source: 'TARGET', target: 'R' }], {});
    assert.equal(paths.length, 1);
    assert.deepEqual(paths[0].nodeIds, ['R', 'TARGET']);
    assert.equal(paths[0].hops, 1);
  });

  it('orders paths by contribution, strongest first', () => {
    const papers = [
      paper('R_NEAR', { status: 'retracted', retractionYear: 2015 }),
      paper('R_FAR', { status: 'retracted', retractionYear: 2015 }),
      paper('MID', { publicationYear: 2018 }),
      paper('TARGET', { publicationYear: 2020 }),
    ];
    const edges: ScoringEdge[] = [
      { source: 'TARGET', target: 'R_NEAR' },
      { source: 'TARGET', target: 'MID' },
      { source: 'MID', target: 'R_FAR' },
    ];
    const paths = explainPaths('TARGET', papers, edges, {});
    assert.equal(paths.length, 2);
    assert.ok(paths[0].contribution >= paths[1].contribution);
    assert.equal(paths[0].hops, 1, 'the direct hit should rank first');
  });

  it('returns nothing for a clean paper', () => {
    const papers = [paper('A'), paper('B')];
    const paths = explainPaths('A', papers, [{ source: 'A', target: 'B' }], {});
    assert.equal(paths.length, 0);
  });

  it('respects maxPaths', () => {
    const papers: ScoringPaper[] = [paper('TARGET')];
    const edges: ScoringEdge[] = [];
    for (let i = 0; i < 40; i += 1) {
      papers.push(paper(`R${i}`, { status: 'retracted', retractionYear: 1990 }));
      edges.push({ source: 'TARGET', target: `R${i}` });
    }
    assert.equal(explainPaths('TARGET', papers, edges, { maxPaths: 5 }).length, 5);
  });

  it('terminates on cyclic data', () => {
    const papers = [paper('A'), paper('B')];
    const edges: ScoringEdge[] = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'A' },
    ];
    assert.equal(explainPaths('A', papers, edges, {}).length, 0);
  });
});

describe('bandFor', () => {
  const assessment = (score: number, minHops: number | null = 1) => ({
    score, dose: 0, directHits: 0, totalUpstreamRetractions: 0,
    minHops, postRetractionCitations: 0, version: 'v', computedAt: null,
    citationIntent: null, intentReason: null,
  });

  it('labels the flagged source distinctly from a high score', () => {
    assert.equal(bandFor(assessment(100, 0)), 'source');
    assert.equal(bandFor(assessment(95, 1)), 'high');
  });

  it('covers the full range in ascending order', () => {
    assert.equal(bandFor(null), 'none');
    assert.equal(bandFor(assessment(0)), 'none');
    assert.equal(bandFor(assessment(5)), 'trace');
    assert.equal(bandFor(assessment(20)), 'low');
    assert.equal(bandFor(assessment(45)), 'moderate');
    assert.equal(bandFor(assessment(80)), 'high');
  });
});
