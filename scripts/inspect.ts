/** Inspect one paper end-to-end: status, notice, score and its explanation. */
import { log } from './lib/env';
import { closeDriver } from '../src/lib/db/driver';
import { getPaperByDoi, getContaminationPaths, getPaperGraph } from '../src/lib/db/queries/paper';

async function main() {
  const doi = process.argv[2] ?? '10.1038/nature04533';
  const paper = await getPaperByDoi(doi);
  if (!paper) { log(`not found: ${doi}`); return; }

  log(`title       ${(paper.title ?? '').slice(0, 72)}`);
  log(`doi         ${paper.doi}`);
  log(`published   ${paper.publicationDate ?? paper.publicationYear}`);
  log(`venue       ${paper.venue ?? '-'}`);
  log(`authors     ${paper.authors.slice(0, 3).map((a) => a.name).join(', ')}${paper.authors.length > 3 ? ` +${paper.authors.length - 3}` : ''}`);
  log(`citedBy     ${paper.citedByCount}   references ${paper.referencedCount}`);
  log(`status      ${paper.status}`);
  log(`notice      ${paper.retraction?.noticeDate ?? '-'} (${paper.retraction?.nature ?? '-'})`);
  log(`reasons     ${paper.retraction?.reasons.join('; ') || '-'}`);
  log(`source      ${paper.retraction?.source ?? '-'}`);
  log(`score       ${paper.contamination?.score ?? '-'}  version ${paper.contamination?.version ?? '-'}`);
  log(`  minHops ${paper.contamination?.minHops}  directHits ${paper.contamination?.directHits}  postRetraction ${paper.contamination?.postRetractionCitations}`);

  const graph = await getPaperGraph(doi, { direction: 'downstream', depth: 2, limit: 50 });
  if (graph) {
    log('');
    log(`downstream  ${graph.nodes.length} nodes, ${graph.edges.length} edges` +
        `${graph.meta.truncated ? ` (truncated from ${graph.meta.totalAvailable})` : ''}`);
    log(`  retracted ${graph.meta.retractedCount}  contaminated ${graph.meta.contaminatedCount}`);
    const postRetraction = graph.edges.filter((e) => e.postRetraction).length;
    log(`  post-notice citation edges: ${postRetraction}`);
  }

  const paths = await getContaminationPaths(paper.id, 5);
  if (paths.length) {
    log('');
    log('contamination paths:');
    for (const p of paths) {
      log(`  ${p.hops} hop(s)${p.postRetraction ? ' [post-notice]' : ''}: ` +
          p.nodes.map((n) => (n.title ?? n.id).slice(0, 28)).join('  ->  '));
    }
  }
}

main()
  .catch((e) => { process.stderr.write(`${(e as Error).stack}\n`); process.exitCode = 1; })
  .finally(() => closeDriver());
