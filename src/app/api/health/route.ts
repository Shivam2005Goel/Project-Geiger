import { NextResponse } from 'next/server';
import { getDriver } from '@/lib/db/driver';

export const runtime = 'nodejs'; // Required for Neo4j driver

export async function GET() {
  try {
    const driver = getDriver();
    const serverInfo = await driver.getServerInfo();
    return NextResponse.json({
      status: 'ok',
      neo4j: 'connected',
      server: serverInfo.address,
    });
  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json(
      { status: 'error', message: 'Database connection failed' },
      { status: 500 }
    );
  }
}
