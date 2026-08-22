import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyIntent, isLikelyMetaResearch } from './intent';

describe('classifyIntent', () => {
  it('catches the real false positives from the Lesné corpus', () => {
    // Every one of these scored as heavily "contaminated" before the heuristic
    // existed, despite citing the retracted paper to criticise it.
    const realTitles = [
      'Academic Research Integrity Investigations Must be Independent, Fair, and Transparent',
      'We Should Do More Direct Replications in Science',
      'Performance of AI Tools in Citing Retracted Literature: Content Analysis',
      "Doctored: Fraud, Arrogance, and Tragedy in the Quest to Cure Alzheimer's",
    ];

    for (const title of realTitles) {
      const result = classifyIntent({ title });
      assert.equal(result.intent, 'disputing', `should flag: ${title}`);
      assert.ok(result.reason, 'a classification must come with a reason');
    }
  });

  it('does not flag ordinary research that builds on the work', () => {
    const substantive = [
      'Amyloid Oligomers Exacerbate Tau Pathology in a Mouse Model',
      'Cortical Synaptic Integration in Alzheimer Disease',
      'A Novel Memantine Schiff Base Derivative for Neuroprotection',
      'In silico structure-based multi-targeted molecular docking analysis',
      'Aβ*56 is present in brain extracts enriched for extracellular proteins',
    ];

    for (const title of substantive) {
      assert.equal(
        classifyIntent({ title }).intent,
        null,
        `should not flag substantive research: ${title}`,
      );
    }
  });

  it('flags meta-research venues', () => {
    const result = classifyIntent({
      title: 'Citation patterns in the neurosciences',
      venue: 'Research Integrity and Peer Review',
    });
    assert.equal(result.intent, 'disputing');
    assert.equal(result.confidence, 'low', 'venue alone is weaker than a title match');
  });

  it('rates an explicit title match above a venue match', () => {
    const byTitle = classifyIntent({ title: 'Retraction of a landmark paper' });
    const byVenue = classifyIntent({ title: 'Unrelated', venue: 'Scientometrics' });
    assert.equal(byTitle.confidence, 'medium');
    assert.equal(byVenue.confidence, 'low');
  });

  it('flags on subject classification', () => {
    const result = classifyIntent({
      title: 'An analysis of downstream effects',
      concepts: ['Scientific misconduct', 'Bibliometrics'],
    });
    assert.equal(result.intent, 'disputing');
  });

  it('needs a textual signal before commentary type counts', () => {
    // An editorial can perfectly well endorse a finding.
    assert.equal(classifyIntent({ title: 'On amyloid beta', type: 'editorial' }).intent, null);
    assert.equal(
      classifyIntent({ title: 'A note of concern about amyloid work', type: 'editorial' }).intent,
      'disputing',
    );
  });

  it('does not flag reviews merely for being reviews', () => {
    // Review articles usually do rest on the literature they review.
    assert.equal(
      classifyIntent({ title: 'Amyloid beta oligomers: a review', type: 'review' }).intent,
      null,
    );
  });

  it('handles missing and empty metadata', () => {
    assert.equal(classifyIntent({}).intent, null);
    assert.equal(classifyIntent({ title: null, venue: null, type: null }).intent, null);
    assert.equal(classifyIntent({ title: '', concepts: [] }).intent, null);
  });

  it('exposes a boolean helper for the UI', () => {
    assert.equal(isLikelyMetaResearch({ title: 'Retraction Watch at ten years' }), true);
    assert.equal(isLikelyMetaResearch({ title: 'Tau propagation in vivo' }), false);
  });
});
