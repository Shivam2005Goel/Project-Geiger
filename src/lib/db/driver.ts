import neo4j, { Driver } from 'neo4j-driver';

let driver: Driver;

export function getDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI;
    const user = process.env.NEO4J_USERNAME;
    const password = process.env.NEO4J_PASSWORD;

    if (!uri || !user || !password) {
      throw new Error('Neo4j credentials not found in environment variables');
    }

    // Initialize the driver singleton
    // maxConnectionPoolSize: 5 and connectionAcquisitionTimeout: 10000 
    // to handle Serverless connection limits (200 max) gracefully.
    driver = neo4j.driver(
      uri,
      neo4j.auth.basic(user, password),
      {
        maxConnectionPoolSize: 5,
        connectionAcquisitionTimeout: 10000,
      }
    );
  }
  return driver;
}
