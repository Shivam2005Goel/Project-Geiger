import neo4j, { Driver, Integer, Session, SessionMode } from 'neo4j-driver';

let driver: Driver | null = null;

/**
 * Shared Neo4j driver.
 *
 * The pool is sized for serverless: many short-lived function instances each
 * holding a few connections, against Aura's per-instance ceiling. The previous
 * value of 5 with a 10s acquisition timeout meant a handful of concurrent
 * requests would queue and then fail rather than wait.
 */
export function getDriver(): Driver {
  if (driver) return driver;

  const uri = process.env.COGNODB_URI;
  const user = process.env.COGNODB_USERNAME;
  const password = process.env.COGNODB_PASSWORD;

  if (!uri || !user || !password) {
    throw new Error(
      'CognoDB credentials missing. Set COGNODB_URI, COGNODB_USERNAME and COGNODB_PASSWORD in .env',
    );
  }

  driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
    maxConnectionPoolSize: Number(process.env.COGNODB_POOL_SIZE ?? 25),
    connectionAcquisitionTimeout: 30_000,
    // Aura drops idle connections; recycling below that window avoids handing
    // out a socket the server has already closed.
    maxConnectionLifetime: 55 * 60 * 1000,
    connectionTimeout: 15_000,
    // Retry transient failures (leader switches, timeouts) inside the driver
    // rather than surfacing them as 500s.
    maxTransactionRetryTime: 15_000,
    disableLosslessIntegers: true,
  });

  return driver;
}

/** Database name, for Aura instances that host more than the default. */
export function databaseName(): string | undefined {
  return process.env.COGNODB_DATABASE || undefined;
}

export function getSession(mode: SessionMode = neo4j.session.READ): Session {
  return getDriver().session({
    database: databaseName(),
    defaultAccessMode: mode,
  });
}

/**
 * Run a read query and always close the session, including on throw.
 *
 * Every read path goes through here so a leaked session cannot exhaust the
 * pool — the failure mode that makes a graph app fall over under load.
 */
export async function withRead<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  const session = getSession(neo4j.session.READ);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

export async function withWrite<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  const session = getSession(neo4j.session.WRITE);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

/**
 * Coerce a Neo4j numeric to a plain number.
 *
 * The driver is configured with `disableLosslessIntegers`, but values written
 * by older ingest runs may still arrive as Integer objects, so reads stay
 * defensive.
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Wrap a JavaScript number as a Neo4j Integer.
 *
 * Required anywhere a value reaches LIMIT, SKIP or a list slice. JavaScript
 * has only one numeric type, so a plain 400 arrives at the server as the float
 * 400.0, and Cypher rejects a float where it wants an integer. `disableLossless-
 * Integers` governs the read direction only and does not help here.
 */
export function int(value: number): Integer {
  return neo4j.int(Math.trunc(value));
}
