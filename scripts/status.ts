/** Print corpus health: coverage, scoring freshness, and the worst offenders. */
import { log } from './lib/env';
import { closeDriver } from '../src/lib/db/driver';
import { getStats } from '../src/lib/db/queries/search';
import { getMostContaminated } from '../src/lib/db/queries/paper';
import { retractionCoverage } from '../src/lib/ingest/enrich';
import { SCORE_VERSION } from '../src/lib/config';

async function main() {
  const stats = await getStats();
  if (!stats) {
    log('corpus is empty — run: npm run ingest -- --seed <doi>');
    return;
  }

  log(`papers          ${stats.papers}`);
  log(`citations       ${stats.citations}`);
  log(`retracted       ${stats.retracted}`);
  log(`under concern   ${stats.concerned}`);
  log(`corrected       ${stats.corrected}`);
  log(`contaminated    ${stats.contaminated}`);
  log(`years           ${stats.earliestYear ?? '?'}-${stats.latestYear ?? '?'}`);
  log(`scored          ${stats.scored}/${stats.papers} @ ${stats.scoreVersion}`);
  if (stats.scoreVersion !== SCORE_VERSION && stats.scored > 0) {
    log(`  stale: current model is ${SCORE_VERSION} — run: npm run score`);
  }

  const coverage = await retractionCoverage();
  log(`notice dates    ${coverage.withDates}/${coverage.flagged} flagged papers`);
  if (coverage.flagged > coverage.withDates) {
    log('  papers without a notice date fall back to "unknown timing" weighting');
  }

  const worst = await getMostContaminated(10);
  if (worst.length) {
    log('');
    log('most contaminated:');
    for (const paper of worst) {
      const score = paper.contamination?.score ?? 0;
      const hops = paper.contamination?.minHops ?? '?';
      const post = paper.contamination?.postRetractionCitations ?? 0;
      log(
        `  ${String(score).padStart(5)}  gen${hops}  ${post > 0 ? `${post} post-retraction  ` : ''}` +
          `${(paper.title ?? paper.id).slice(0, 70)}`,
      );
    }
  }
}

main()
  .catch((e) => { process.stderr.write(`${(e as Error).stack}\n`); process.exitCode = 1; })
  .finally(() => closeDriver());
