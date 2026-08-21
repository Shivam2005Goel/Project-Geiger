import fs from 'fs';
import path from 'path';

const SEED_DOIS = [
  '10.1038/nature04533' // 2006 Lesné Alzheimer's paper
];

const MAX_DEPTH = 2;
const MAX_FAN_OUT = 200;

interface OpenAlexWork {
  id: string;
  doi: string;
  title: string;
  publication_year: number;
  is_retracted: boolean;
  referenced_works: string[];
}

const visited = new Set<string>();
const graphNodes: any[] = [];
const graphEdges: { source: string; target: string }[] = [];

async function fetchWorkByDoi(doi: string): Promise<OpenAlexWork | null> {
  const url = `https://api.openalex.org/works/https://doi.org/${doi}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function fetchWorkById(id: string): Promise<OpenAlexWork | null> {
  try {
    const res = await fetch(id);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function crawl(workId: string, depth: number) {
  if (depth > MAX_DEPTH || visited.has(workId)) return;
  visited.add(workId);
  
  console.log(`Crawling ${workId} at depth ${depth}`);
  const work = await fetchWorkById(workId);
  if (!work) return;

  // Add node
  graphNodes.push({
    openalexId: work.id,
    doi: work.doi ? work.doi.replace('https://doi.org/', '') : null,
    title: work.title,
    publicationYear: work.publication_year,
    retracted: work.is_retracted,
  });

  // Citations (works that this work references)
  const refs = work.referenced_works || [];
  const cappedRefs = refs.slice(0, MAX_FAN_OUT);
  
  for (const refId of cappedRefs) {
    graphEdges.push({ source: work.id, target: refId });
    await crawl(refId, depth + 1);
  }
}

async function main() {
  console.log('Starting OpenAlex crawl...');
  for (const doi of SEED_DOIS) {
    const work = await fetchWorkByDoi(doi);
    if (work) {
      await crawl(work.id, 0);
    }
  }
  
  const data = { nodes: graphNodes, edges: graphEdges };
  const outPath = path.join(process.cwd(), 'openalex-data.json');
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Saved ${graphNodes.length} nodes and ${graphEdges.length} edges to ${outPath}`);
}

main().catch(console.error);
