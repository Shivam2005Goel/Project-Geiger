import { getDriver } from '../driver';

export interface PaperNode {
  id: string;
  doi: string;
  title: string;
  publicationYear: number;
  retracted: boolean;
  retractionYear?: number;
  retractionReason?: string;
  contaminationScore: number;
}

export interface CitationEdge {
  source: string;
  target: string;
}

export interface PaperGraph {
  nodes: PaperNode[];
  edges: CitationEdge[];
}

export async function getPaperGraph(doi: string): Promise<PaperGraph | null> {
  const driver = getDriver();
  const session = driver.session();
  try {
    // We want to get the specific paper, and its citation neighborhood.
    // We get papers that cite it, or papers it cites. Let's do a basic 2-hop neighborhood, 
    // or just the component it belongs to.
    // But since the database is small, we can fetch the subgraph related to this paper.
    // The query finds the paper and its citations up to 2 hops away.
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH path = (root:Paper {doi: $doi})<-[:CITES*0..2]-(citer:Paper)
        UNWIND nodes(path) AS n
        UNWIND relationships(path) AS r
        WITH collect(distinct n) AS nodes, collect(distinct r) AS rels
        RETURN nodes, rels
        `,
        { doi }
      )
    );

    if (result.records.length === 0) {
      return null;
    }

    const record = result.records[0];
    const nodesRaw = record.get('nodes') || [];
    const relsRaw = record.get('rels') || [];

    if (nodesRaw.length === 0 && relsRaw.length === 0) {
      // It might be just the node itself with no relationships, but the query 
      // with *0..2 will at least return the root node. 
      // If root is not found, record.get('nodes') will be empty.
      return null;
    }

    const nodes: PaperNode[] = nodesRaw.map((n: any) => ({
      id: n.properties.openalexId,
      doi: n.properties.doi,
      title: n.properties.title,
      publicationYear: n.properties.publicationYear?.toNumber(),
      retracted: n.properties.retracted || false,
      retractionYear: n.properties.retractionYear?.toNumber(),
      retractionReason: n.properties.retractionReason,
      contaminationScore: n.properties.contaminationScore || 0,
    }));

    const edges: CitationEdge[] = relsRaw.map((r: any) => ({
      source: r.startNodeElementId, // We need the openalexId, not the internal elementId!
      target: r.endNodeElementId,
    }));
    
    // Better edge parsing to use openalexId:
    // To do this properly we need to extract the openalexId for source/target.
    // We can do this by mapping the internal elementId to openalexId from the nodes list.
    const elementIdToOpenAlexId = new Map<string, string>();
    nodesRaw.forEach((n: any) => {
      elementIdToOpenAlexId.set(n.elementId, n.properties.openalexId);
    });

    const safeEdges: CitationEdge[] = relsRaw.map((r: any) => ({
      source: elementIdToOpenAlexId.get(r.startNodeElementId)!,
      target: elementIdToOpenAlexId.get(r.endNodeElementId)!,
    })).filter((e: any) => e.source && e.target);

    return { nodes, edges: safeEdges };
  } finally {
    await session.close();
  }
}
