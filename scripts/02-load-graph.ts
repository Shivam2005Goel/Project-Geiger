import fs from 'fs';
import path from 'path';
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

// Load .env relative to project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const uri = process.env.NEO4J_URI;
const user = process.env.NEO4J_USERNAME;
const password = process.env.NEO4J_PASSWORD;

if (!uri || !user || !password) {
  console.error('Missing Neo4j credentials');
  process.exit(1);
}

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

async function main() {
  const dataPath = path.join(process.cwd(), 'openalex-data.json');
  if (!fs.existsSync(dataPath)) {
    console.error('Data file not found. Run 01-fetch-openalex.ts first.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const session = driver.session();

  try {
    console.log('Creating constraints...');
    await session.executeWrite((tx) =>
      tx.run('CREATE CONSTRAINT IF NOT EXISTS FOR (p:Paper) REQUIRE p.openalexId IS UNIQUE')
    );
    await session.executeWrite((tx) =>
      tx.run('CREATE INDEX IF NOT EXISTS FOR (p:Paper) ON (p.doi)')
    );

    console.log('Loading nodes...');
    await session.executeWrite((tx) =>
      tx.run(
        `
        UNWIND $nodes AS node
        MERGE (p:Paper {openalexId: node.openalexId})
        SET p.doi = node.doi,
            p.title = node.title,
            p.publicationYear = node.publicationYear,
            p.retracted = node.retracted,
            // Precompute a dummy contamination score for now. 
            // The prompt says "compute the contamination score once during seeding"
            p.contaminationScore = CASE WHEN node.retracted THEN 100 ELSE 10 END
        `,
        { nodes: data.nodes }
      )
    );

    console.log('Loading edges...');
    await session.executeWrite((tx) =>
      tx.run(
        `
        UNWIND $edges AS edge
        MATCH (source:Paper {openalexId: edge.source})
        MATCH (target:Paper {openalexId: edge.target})
        MERGE (source)-[:CITES]->(target)
        `,
        { edges: data.edges }
      )
    );

    console.log('Graph loaded successfully!');
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);
