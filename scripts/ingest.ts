/**
 * Geiger ingest pipeline.
 *
 * Usage:
 *   npm run ingest -- --seed 10.1038/nature04533
 *   npm run ingest -- --retracted 25 --min-citations 100
 *   npm run ingest -- --seed 10.1038/nature04533 --depth 2 --max-works 800
 *
 * Stages, in order, each of which can be run alone:
 *   schema   create constraints and indexes
 *   crawl    walk citations outward from the seeds
 *   enrich   attach retraction dates and reasons from Crossref
 *   score    recompute contamination across the whole corpus
 *
 * Unlike the script this replaces, there is no hardcoded seed DOI and no
 * hardcoded fan-out. Seeds come from the command line or from OpenAlex's
 * retracted-works index, and every budget is an explicit flag with a
 * documented default.
 */

import { args, fatal, list, log, num } from './lib/env';
import { applySchema } from '../src/lib/db/schema';
import { closeDriver } from '../src/lib/db/driver';
import { completeInternalEdges, crawl, type CrawlEdge } from '../src/lib/ingest/crawl';
import { enrichRetractions, retractionCoverage } from '../src/lib/ingest/enrich';
import { persist, scoreCorpus } from '../src/lib/ingest/persist';
import { fetchRetractedWorks, normaliseDoi } from '../src/lib/sources/openalex';
import { requireContactEmail } from '../src/lib/sources/http';
import { getStats } from '../src/lib/db/queries/search';
import type { PaperNode } from '../src/lib/types';

const HELP = `
Geiger ingest pipeline

  --seed <doi>            Seed DOI. Repeatable via comma separation.
  --retracted <n>         Seed from the n most-cited retracted works in OpenAlex.
  --min-citations <n>     With --retracted: only seeds above this citation count.
  --from-year <yyyy>      With --retracted: only seeds published from this year.

  --depth <n>             Generations to crawl outward.          (default 2)
  --max-works <n>         Ceiling on works fetched per seed.     (default 400)
  --per-generation <n>    Citing works pulled per paper.         (default 100)
  --direction <dir>       downstream | upstream | both           (default downstream)

  --stages <list>         Comma-separated subset of:
                          schema,crawl,enrich,score               (default all)
  --enrich-limit <n>      Papers to check against Crossref.      (default 1000)
  --recheck-all           Re-check retraction status for every paper.
  --help                  Show this message.
`;

async function main() {
  const flags = args();
  if (flags.help) {
    process.stdout.write(HELP);
    return;
  }

  // Fail before any network or database work if the crawler cannot identify
  // itself — running anonymously gets the project throttled.
  try {
    requireContactEmail();
  } catch (error) {
    fatal((error as Error).message);
  }

  const stages = new Set(
    list(flags.stages).length ? list(flags.stages) : ['schema', 'crawl', 'enrich', 'score'],
  );

  const depth = num(flags.depth, 2);
  const maxWorks = num(flags['max-works'], 400);
  const perGeneration = num(flags['per-generation'], 100);
  const direction = (typeof flags.direction === 'string' ? flags.direction : 'downstream') as
    | 'downstream' | 'upstream' | 'both';

  if (!['downstream', 'upstream', 'both'].includes(direction)) {
    fatal(`--direction must be downstream, upstream or both (got "${direction}")`);
  }

  if (stages.has('schema')) {
    log('stage: schema');
    const applied = await applySchema();
    log(`  applied ${applied.length} constraints and indexes`);
  }

  if (stages.has('crawl')) {
    log('stage: crawl');
    const seeds = await resolveSeeds(flags);
    if (!seeds.length) {
      fatal(
        'No seeds. Pass --seed <doi> or --retracted <n>.\n' +
          'Example: npm run ingest -- --seed 10.1038/nature04533',
      );
    }
    log(`  ${seeds.length} seed(s): ${seeds.slice(0, 3).join(', ')}${seeds.length > 3 ? ' ...' : ''}`);

    const allNodes = new Map<string, PaperNode>();
    const allEdges = new Map<string, CrawlEdge>();

    for (const [index, seed] of seeds.entries()) {
      log(`  [${index + 1}/${seeds.length}] crawling ${seed}`);
      const result = await crawl(seed, {
        depth,
        maxWorks,
        perGeneration,
        direction,
        onProgress: (m) => log(`      ${m}`),
      });

      if (!result.seed) {
        log(`      not found in OpenAlex, skipping`);
        continue;
      }

      for (const node of result.nodes) allNodes.set(node.id, node);
      for (const edge of result.edges) allEdges.set(`${edge.source} ${edge.target}`, edge);

      log(
        `      ${result.nodes.length} works, ${result.edges.length} citations` +
          (result.stats.truncated
            ? ` (${result.stats.skippedForBudget} beyond budget)`
            : ''),
      );
    }

    // Recover sibling citations the breadth-first walk did not travel along.
    log(`  completing internal citations across ${allNodes.size} works...`);
    const internal = await completeInternalEdges([...allNodes.values()], [...allEdges.values()]);
    for (const edge of internal) allEdges.set(`${edge.source} ${edge.target}`, edge);
    log(`    +${internal.length} sibling citations`);

    const written = await persist([...allNodes.values()], [...allEdges.values()]);
    log(`  wrote ${written.nodesWritten} papers, ${written.edgesWritten} citations`);
  }

  if (stages.has('enrich')) {
    log('stage: enrich (Crossref / Retraction Watch)');
    const summary = await enrichRetractions({
      limit: num(flags['enrich-limit'], 1000),
      recheckAll: flags['recheck-all'] === true,
      onProgress: (done, total, message) => log(`  ${done}/${total} — ${message}`),
    });
    log(
      `  checked ${summary.checked}, updated ${summary.updated}, ` +
        `newly flagged ${summary.newlyFlagged}, dates added ${summary.datesAdded}, ` +
        `source conflicts ${summary.conflicted}, failed ${summary.failed}`,
    );

    const coverage = await retractionCoverage();
    log(
      `  coverage: ${coverage.flagged} flagged, ${coverage.withDates} with notice dates, ` +
        `${coverage.checked}/${coverage.total} checked`,
    );
  }

  if (stages.has('score')) {
    log('stage: score');
    const summary = await scoreCorpus({ onProgress: (m) => log(`  ${m}`) });
    log(
      `  scored ${summary.papersScored} papers in ${(summary.durationMs / 1000).toFixed(1)}s — ` +
        `${summary.flagged} flagged, ${summary.contaminated} contaminated, ` +
        `${summary.commentary} commentary`,
    );
    log(`  version ${summary.version}`);
  }

  const stats = await getStats();
  if (stats) {
    log('');
    log('corpus:');
    log(`  ${stats.papers} papers, ${stats.citations} citations`);
    log(`  ${stats.retracted} retracted, ${stats.concerned} under concern, ${stats.corrected} corrected`);
    log(`  ${stats.contaminated} papers carry contamination`);
    log(`  years ${stats.earliestYear ?? '?'}–${stats.latestYear ?? '?'}`);
  }
}

/** Seeds come from explicit DOIs, from OpenAlex's retracted index, or both. */
async function resolveSeeds(flags: Record<string, string | boolean>): Promise<string[]> {
  const seeds: string[] = [];

  for (const raw of list(flags.seed)) {
    const doi = normaliseDoi(raw);
    if (doi) seeds.push(doi);
    else log(`  ignoring unrecognised seed "${raw}"`);
  }

  const retractedCount = num(flags.retracted, 0);
  if (retractedCount > 0) {
    log(`  fetching ${retractedCount} most-cited retracted works from OpenAlex...`);
    const works = await fetchRetractedWorks({
      limit: retractedCount,
      minCitations: num(flags['min-citations'], 0) || undefined,
      fromYear: num(flags['from-year'], 0) || undefined,
    });
    for (const work of works) {
      const doi = work.doi ? normaliseDoi(work.doi) : null;
      // Fall back to the OpenAlex ID: a retracted work without a DOI is still
      // worth crawling, and the resolver accepts either form.
      seeds.push(doi ?? work.id);
    }
    log(`    found ${works.length}`);
  }

  return [...new Set(seeds)];
}

main()
  .catch((error) => {
    process.stderr.write(`\nPipeline failed: ${(error as Error).message}\n`);
    process.stderr.write(`${(error as Error).stack}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDriver());
