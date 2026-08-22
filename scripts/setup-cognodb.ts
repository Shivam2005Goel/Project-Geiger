import 'dotenv/config';
import { getDriver } from '../src/lib/db/driver';

async function main() {
  const driver = getDriver();
  const session = driver.session();
  
  try {
    console.log('Creating constraints...');
    await session.executeWrite((tx) =>
      tx.run('CREATE CONSTRAINT paper_id IF NOT EXISTS FOR (p:Paper) REQUIRE p.openalexId IS UNIQUE')
    );
    await session.executeWrite((tx) =>
      tx.run('CREATE CONSTRAINT author_id IF NOT EXISTS FOR (a:Author) REQUIRE a.id IS UNIQUE')
    );
    console.log('Constraints created successfully.');
  } catch (err) {
    console.error('Failed to create constraints:', err);
  } finally {
    await session.close();
    await driver.close();
  }
}

main();
