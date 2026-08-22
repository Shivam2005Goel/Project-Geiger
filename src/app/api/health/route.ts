import { NextResponse } from 'next/server';
import { getDriver } from '@/lib/db/driver';
import { getStats } from '@/lib/db/queries/search';
import { SCORE_VERSION } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness and readiness.
 *
 * Reports `degraded` when the database is reachable but empty or unscored,
 * because an app serving zeroes out of an unscored corpus is not working even
 * though every request returns 200.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    const info = await getDriver().getServerInfo();
    checks.neo4j = { ok: true, detail: info.address };
  } catch (error) {
    checks.neo4j = { ok: false, detail: (error as Error).message };
    return NextResponse.json(
      { status: 'error', checks, scoreVersion: SCORE_VERSION },
      { status: 503 },
    );
  }

  try {
    const stats = await getStats();
    if (!stats || stats.papers === 0) {
      checks.corpus = { ok: false, detail: 'empty — run npm run ingest' };
    } else if (stats.scored < stats.papers) {
      checks.corpus = {
        ok: false,
        detail: `${stats.papers - stats.scored} of ${stats.papers} papers unscored — run npm run score`,
      };
    } else {
      checks.corpus = {
        ok: true,
        detail: `${stats.papers} papers, ${stats.citations} citations`,
      };
    }
  } catch (error) {
    checks.corpus = { ok: false, detail: (error as Error).message };
  }

  const degraded = Object.values(checks).some((c) => !c.ok);
  return NextResponse.json(
    { status: degraded ? 'degraded' : 'ok', checks, scoreVersion: SCORE_VERSION },
    { status: 200 },
  );
}
